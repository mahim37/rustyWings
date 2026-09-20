//! `rustywings`: the headless side of the project.
//!
//! The same crate that runs in the browser runs here, natively and in
//! parallel, which is what makes the CI checks meaningful: `verify` pins a
//! checksum so any change to the simulation is deliberate, and `arena` proves
//! that evolved brains beat random ones. `sweep` is how default parameters
//! were chosen: a grid of variants across seeds, one summary row each.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand, ValueEnum};
use rayon::prelude::*;
use rustywings_core::{
    Config, Genome, Species, Stats, World, arena_score_many, arena_score_random,
};

#[derive(Parser)]
#[command(
    name = "rustywings",
    version,
    about = "Headless runner for the rustyWings ecosystem simulation"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run a world and stream statistics.
    Run(RunArgs),
    /// Measure ticks per second at a given population.
    Bench(BenchArgs),
    /// Print (and optionally assert) the checksum of a run. Same seed, same
    /// bits, on every platform.
    Verify(VerifyArgs),
    /// The learning test: do evolved sparrows out-forage random ones in a
    /// standardised arena?
    Arena(ArenaArgs),
    /// Run a grid of parameter variants across seeds and summarise each run
    /// in one CSV row.
    Sweep(SweepArgs),
    /// Print the default configuration as JSON.
    Config,
}

#[derive(Clone, Copy, ValueEnum)]
enum Format {
    Csv,
    Jsonl,
}

#[derive(clap::Args)]
struct RunArgs {
    /// World seed.
    #[arg(long, default_value_t = 1, conflicts_with = "resume")]
    seed: u64,
    /// Ticks to simulate.
    #[arg(long, default_value_t = 20_000)]
    ticks: u64,
    /// Emit a stats row every N ticks.
    #[arg(long, default_value_t = 250)]
    every: u64,
    /// JSON config file (see `rustywings config`).
    #[arg(long, conflicts_with = "resume")]
    config: Option<PathBuf>,
    /// Continue from a snapshot instead of starting a new world. The
    /// browser's "Save world" button and `--snapshot` write these.
    #[arg(long, value_name = "FILE")]
    resume: Option<PathBuf>,
    /// Write stats here instead of stdout.
    #[arg(long)]
    out: Option<PathBuf>,
    /// Output format.
    #[arg(long, value_enum, default_value_t = Format::Csv)]
    format: Format,
    /// Save a snapshot of the final world here.
    #[arg(long)]
    snapshot: Option<PathBuf>,
}

#[derive(clap::Args)]
struct BenchArgs {
    /// Total birds to start with (95% sparrows, 5% hawks).
    #[arg(long, default_value_t = 5000)]
    agents: u32,
    /// Ticks to time.
    #[arg(long, default_value_t = 500)]
    ticks: u64,
    #[arg(long, default_value_t = 1)]
    seed: u64,
}

#[derive(clap::Args)]
struct VerifyArgs {
    #[arg(long, default_value_t = 1, conflicts_with = "resume")]
    seed: u64,
    /// Ticks to simulate before printing the checksum. With `--resume`,
    /// ticks beyond the snapshot; `0` prints the snapshot's own checksum,
    /// which is what the browser showed when it was saved.
    #[arg(long, default_value_t = 2000)]
    ticks: u64,
    /// Expected checksum (hex). Exit 1 on mismatch.
    #[arg(long)]
    expect: Option<String>,
    #[arg(long, conflicts_with = "resume")]
    config: Option<PathBuf>,
    /// Start from a snapshot instead of a fresh world.
    #[arg(long, value_name = "FILE")]
    resume: Option<PathBuf>,
}

#[derive(clap::Args)]
struct ArenaArgs {
    /// Number of independent worlds to evolve (run in parallel).
    #[arg(long, default_value_t = 3)]
    seeds: u64,
    /// First seed; worlds use seed, seed+1, ...
    #[arg(long, default_value_t = 1)]
    seed: u64,
    /// Ticks to evolve each world before sampling genomes.
    #[arg(long, default_value_t = 40_000)]
    ticks: u64,
    /// Genomes sampled per world (evenly spaced through the population).
    #[arg(long, default_value_t = 24)]
    samples: u32,
    /// Ticks each genome gets alone in the arena.
    #[arg(long, default_value_t = 1500)]
    arena_ticks: u32,
    /// Required ratio of evolved mean meals to random mean meals.
    #[arg(long, default_value_t = 1.5)]
    threshold: f32,
    #[arg(long)]
    config: Option<PathBuf>,
}

#[derive(clap::Args)]
struct SweepArgs {
    /// Base config; the defaults when omitted.
    #[arg(long)]
    config: Option<PathBuf>,
    /// A dotted field and the values to try, e.g. `plants.regrowth=6,12,24`.
    /// Repeat for a grid: variants are the cartesian product.
    #[arg(long = "set", value_name = "FIELD=V1,V2,...", required = true)]
    sets: Vec<String>,
    /// Seeds per variant; worlds use seed, seed+1, ...
    #[arg(long, default_value_t = 2)]
    seeds: u64,
    #[arg(long, default_value_t = 1)]
    seed: u64,
    /// Ticks per run.
    #[arg(long, default_value_t = 60_000)]
    ticks: u64,
    /// Sample stats every N ticks for the summary columns.
    #[arg(long, default_value_t = 500)]
    every: u64,
    /// Write rows here instead of stdout.
    #[arg(long)]
    out: Option<PathBuf>,
}

fn load_config(path: &Option<PathBuf>) -> Result<Config> {
    let Some(path) = path else {
        return Ok(Config::default());
    };
    let text =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let cfg: Config =
        serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
    cfg.validate()?;
    Ok(cfg)
}

fn load_snapshot(path: &Path) -> Result<World> {
    let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    World::from_snapshot(&bytes).with_context(|| format!("restoring {}", path.display()))
}

fn open_out(path: &Option<PathBuf>) -> Result<Box<dyn Write>> {
    Ok(match path {
        Some(p) => Box::new(BufWriter::new(
            File::create(p).with_context(|| format!("creating {}", p.display()))?,
        )),
        None => Box::new(BufWriter::new(std::io::stdout().lock())),
    })
}

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Run(a) => run(a),
        Cmd::Bench(a) => bench(a),
        Cmd::Verify(a) => verify(a),
        Cmd::Arena(a) => arena(a),
        Cmd::Sweep(a) => sweep(a),
        Cmd::Config => {
            println!("{}", serde_json::to_string_pretty(&Config::default())?);
            Ok(())
        }
    }
}

const CSV_HEADER: &str = "tick,plants,herb,pred,herb_energy,herb_fov_deg,herb_range,herb_speed,herb_size,herb_gen,pred_energy,pred_fov_deg,pred_range,pred_speed,pred_size,pred_gen,herb_births,herb_starved,herb_aged,herb_predated,herb_meals,herb_immigrants,pred_births,pred_starved,pred_aged,pred_meals,pred_immigrants";

fn csv_row(s: &Stats) -> String {
    let h = &s.species[0];
    let p = &s.species[1];
    let th = &s.totals[0];
    let tp = &s.totals[1];
    let deg = |r: f32| r.to_degrees();
    format!(
        "{},{},{},{},{:.4},{:.1},{:.4},{:.5},{:.3},{:.2},{:.4},{:.1},{:.4},{:.5},{:.3},{:.2},{},{},{},{},{},{},{},{},{},{},{}",
        s.tick,
        s.plants,
        h.count,
        p.count,
        h.mean_energy,
        deg(h.mean_fov_angle),
        h.mean_fov_range,
        h.mean_max_speed,
        h.mean_size,
        h.mean_generation,
        p.mean_energy,
        deg(p.mean_fov_angle),
        p.mean_fov_range,
        p.mean_max_speed,
        p.mean_size,
        p.mean_generation,
        th.births,
        th.deaths_starved,
        th.deaths_aged,
        th.deaths_predated,
        th.meals,
        th.immigrants,
        tp.births,
        tp.deaths_starved,
        tp.deaths_aged,
        tp.meals,
        tp.immigrants,
    )
}

fn run(a: RunArgs) -> Result<()> {
    let mut world = match &a.resume {
        Some(p) => load_snapshot(p)?,
        None => World::new(load_config(&a.config)?, a.seed)?,
    };
    let mut out = open_out(&a.out)?;
    let started = Instant::now();
    let emit = |out: &mut dyn Write, w: &World| -> Result<()> {
        let s = w.stats();
        match a.format {
            Format::Csv => writeln!(out, "{}", csv_row(&s))?,
            Format::Jsonl => writeln!(out, "{}", serde_json::to_string(&s)?)?,
        }
        Ok(())
    };
    if matches!(a.format, Format::Csv) {
        writeln!(out, "{CSV_HEADER}")?;
    }
    emit(&mut out, &world)?;
    let every = a.every.max(1);
    let mut done = 0;
    while done < a.ticks {
        let n = every.min(a.ticks - done);
        world.run(n);
        done += n;
        emit(&mut out, &world)?;
    }
    out.flush()?;
    let s = world.stats();
    eprintln!(
        "seed {:x} · tick {} · {} ticks in {:.1}s · herbivores {} · predators {} · plants {} · checksum {:016x}",
        world.seed(),
        world.tick(),
        a.ticks,
        started.elapsed().as_secs_f32(),
        s.species[0].count,
        s.species[1].count,
        s.plants,
        world.checksum()
    );
    if let Some(p) = a.snapshot {
        let bytes = world.to_snapshot();
        std::fs::write(&p, &bytes).with_context(|| format!("writing {}", p.display()))?;
        eprintln!("snapshot {} ({} KB)", p.display(), bytes.len() / 1024);
    }
    Ok(())
}

fn bench(a: BenchArgs) -> Result<()> {
    let mut cfg = Config::default();
    cfg.world.initial_herbivores = a.agents - a.agents / 20;
    cfg.world.initial_predators = a.agents / 20;
    cfg.evolution.immigration_chance = 0.0;
    cfg.world.max_agents = cfg.world.max_agents.max(a.agents * 2);
    cfg.plants.initial = cfg.plants.capacity.min(a.agents * 3);
    cfg.plants.capacity = cfg.plants.capacity.max(a.agents * 3);
    let mut world = World::new(cfg, a.seed)?;
    world.run(20); // warm up caches and let the grid buffers size themselves
    let started = Instant::now();
    let mut agent_ticks = 0u64;
    for _ in 0..a.ticks {
        agent_ticks += world.agents().len() as u64;
        world.step();
    }
    let secs = started.elapsed().as_secs_f64();
    let s = world.stats();
    println!("agents (start)      {}", a.agents);
    println!("agents (mean)       {}", agent_ticks / a.ticks.max(1));
    println!(
        "agents (end)        {}",
        s.species[0].count + s.species[1].count
    );
    println!("plants (end)        {}", s.plants);
    println!("ticks               {}", a.ticks);
    println!("ms per tick         {:.3}", secs * 1000.0 / a.ticks as f64);
    println!("ticks per second    {:.0}", a.ticks as f64 / secs);
    println!(
        "agent-updates/sec   {:.2}M",
        agent_ticks as f64 / secs / 1e6
    );
    Ok(())
}

fn verify(a: VerifyArgs) -> Result<()> {
    let mut world = match &a.resume {
        Some(p) => load_snapshot(p)?,
        None => World::new(load_config(&a.config)?, a.seed)?,
    };
    world.run(a.ticks);
    let sum = world.checksum();
    println!("{sum:016x}");
    if let Some(expect) = a.expect {
        let want = u64::from_str_radix(expect.trim().trim_start_matches("0x"), 16)
            .context("--expect must be hex")?;
        if want != sum {
            bail!("checksum mismatch: expected {want:016x}, got {sum:016x}");
        }
        eprintln!(
            "ok: seed {:x} · tick {} · checksum matches",
            world.seed(),
            world.tick()
        );
    }
    Ok(())
}

fn arena(a: ArenaArgs) -> Result<()> {
    let cfg = load_config(&a.config)?;
    let started = Instant::now();
    let results: Vec<Result<(u64, f32, f32, u32)>> = (0..a.seeds)
        .into_par_iter()
        .map(|k| {
            let seed = a.seed + k;
            let mut world = World::new(cfg.clone(), seed)?;
            world.run(a.ticks);
            let ag = world.agents();
            let herb: Vec<usize> = (0..ag.len())
                .filter(|&i| ag.species_of(i) == Species::Herbivore)
                .collect();
            if herb.is_empty() {
                bail!("seed {seed}: herbivores went extinct");
            }
            let stride = (herb.len() / a.samples as usize).max(1);
            let evolved: Vec<Genome> = herb
                .iter()
                .step_by(stride)
                .take(a.samples as usize)
                .map(|&i| ag.genome[i].clone())
                .collect();
            let arena_seed = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xA5A5;
            let ev = arena_score_many(
                &cfg,
                Species::Herbivore,
                &evolved,
                arena_seed,
                a.arena_ticks,
            )?;
            let rnd = arena_score_random(
                &cfg,
                Species::Herbivore,
                arena_seed,
                a.arena_ticks,
                a.samples,
            )?;
            Ok((seed, ev.mean, rnd.mean, herb.len() as u32))
        })
        .collect();

    println!(
        "{:>6} {:>10} {:>12} {:>12} {:>8}",
        "seed", "sparrows", "evolved", "random", "ratio"
    );
    let mut ratios = Vec::new();
    for r in results {
        let (seed, ev, rnd, n) = r?;
        let ratio = if rnd > 0.0 { ev / rnd } else { f32::INFINITY };
        ratios.push(ratio);
        println!("{seed:>6} {n:>10} {ev:>12.2} {rnd:>12.2} {ratio:>8.2}");
    }
    ratios.sort_by(f32::total_cmp);
    let median = ratios[ratios.len() / 2];
    println!(
        "median ratio {median:.2} (threshold {:.2}) · {:.1}s",
        a.threshold,
        started.elapsed().as_secs_f32()
    );
    if median < a.threshold {
        bail!(
            "learning check failed: evolved sparrows are not {:.2}x better than random",
            a.threshold
        );
    }
    println!("ok: evolved sparrows out-forage random ones");
    Ok(())
}

// ----- sweep ------------------------------------------------------------

/// One `--set`: a dotted field and the values to try.
struct Axis {
    field: String,
    values: Vec<serde_json::Value>,
}

fn parse_axis(text: &str) -> Result<Axis> {
    let (field, values) = text
        .split_once('=')
        .with_context(|| format!("--set {text:?}: expected FIELD=V1,V2,..."))?;
    let values = values
        .split(',')
        .map(|v| {
            let v = v.trim();
            serde_json::from_str(v).unwrap_or_else(|_| serde_json::Value::String(v.to_owned()))
        })
        .collect::<Vec<_>>();
    if values.is_empty() || field.trim().is_empty() {
        bail!("--set {text:?}: expected FIELD=V1,V2,...");
    }
    Ok(Axis {
        field: field.trim().to_owned(),
        values,
    })
}

/// Apply one `field=value` to a JSON config, insisting that the field exists
/// so a typo is an error rather than a silently unchanged run.
fn set_field(cfg: &mut serde_json::Value, field: &str, value: &serde_json::Value) -> Result<()> {
    let pointer = format!("/{}", field.replace('.', "/"));
    let slot = cfg
        .pointer_mut(&pointer)
        .with_context(|| format!("no such config field `{field}`"))?;
    *slot = value.clone();
    Ok(())
}

/// Every combination of axis values, as index vectors, first axis slowest.
fn grid(axes: &[Axis]) -> Vec<Vec<usize>> {
    let mut out = vec![Vec::new()];
    for axis in axes {
        out = out
            .into_iter()
            .flat_map(|prefix| {
                (0..axis.values.len()).map(move |i| {
                    let mut v = prefix.clone();
                    v.push(i);
                    v
                })
            })
            .collect();
    }
    out
}

struct SweepRow {
    variant: usize,
    seed: u64,
    end: Stats,
    herb_mean: f64,
    pred_mean: f64,
    plants_mean: f64,
    herb_min: u32,
    pred_min: u32,
    herb_extinct: Option<u64>,
    pred_extinct: Option<u64>,
    checksum: u64,
    seconds: f32,
}

fn sweep_one(cfg: Config, seed: u64, ticks: u64, every: u64) -> Result<(Stats, SweepRow)> {
    let started = Instant::now();
    let mut world = World::new(cfg, seed)?;
    let every = every.max(1);
    let half = ticks / 2;
    let (mut sum_h, mut sum_p, mut sum_s, mut n) = (0f64, 0f64, 0f64, 0u32);
    let (mut min_h, mut min_p) = (u32::MAX, u32::MAX);
    let (mut ext_h, mut ext_p) = (None, None);
    let mut done = 0;
    while done < ticks {
        let step = every.min(ticks - done);
        world.run(step);
        done += step;
        let s = world.stats();
        let (h, p) = (s.species[0].count, s.species[1].count);
        if h == 0 && ext_h.is_none() {
            ext_h = Some(s.tick);
        }
        if p == 0 && ext_p.is_none() {
            ext_p = Some(s.tick);
        }
        if done > half {
            sum_h += f64::from(h);
            sum_p += f64::from(p);
            sum_s += f64::from(s.plants);
            n += 1;
            min_h = min_h.min(h);
            min_p = min_p.min(p);
        }
    }
    let end = world.stats();
    let n = f64::from(n.max(1));
    let row = SweepRow {
        variant: 0,
        seed,
        end: end.clone(),
        herb_mean: sum_h / n,
        pred_mean: sum_p / n,
        plants_mean: sum_s / n,
        herb_min: min_h,
        pred_min: min_p,
        herb_extinct: ext_h,
        pred_extinct: ext_p,
        checksum: world.checksum(),
        seconds: started.elapsed().as_secs_f32(),
    };
    Ok((end, row))
}

fn sweep(a: SweepArgs) -> Result<()> {
    let base = serde_json::to_value(load_config(&a.config)?)?;
    let axes = a
        .sets
        .iter()
        .map(|s| parse_axis(s))
        .collect::<Result<Vec<_>>>()?;
    let combos = grid(&axes);
    let mut variants = Vec::with_capacity(combos.len());
    for combo in &combos {
        let mut json = base.clone();
        for (axis, &i) in axes.iter().zip(combo) {
            set_field(&mut json, &axis.field, &axis.values[i])?;
        }
        let cfg: Config = serde_json::from_value(json).context("building variant")?;
        cfg.validate()?;
        variants.push(cfg);
    }
    let jobs: Vec<(usize, u64)> = (0..variants.len())
        .flat_map(|v| (0..a.seeds).map(move |k| (v, a.seed + k)))
        .collect();
    eprintln!(
        "{} variants × {} seeds × {} ticks on {} threads",
        variants.len(),
        a.seeds,
        a.ticks,
        rayon::current_num_threads()
    );
    let started = Instant::now();
    let rows: Vec<Result<SweepRow>> = jobs
        .par_iter()
        .map(|&(v, seed)| {
            let (_, mut row) = sweep_one(variants[v].clone(), seed, a.ticks, a.every)?;
            row.variant = v;
            eprintln!(
                "variant {v} seed {seed}: sparrows {} hawks {} seeds {} · {:.1}s",
                row.end.species[0].count, row.end.species[1].count, row.end.plants, row.seconds
            );
            Ok(row)
        })
        .collect();

    let mut out = open_out(&a.out)?;
    let fields: Vec<String> = axes.iter().map(|x| x.field.replace('.', "_")).collect();
    writeln!(
        out,
        "variant,{},seed,ticks,herb_end,pred_end,plants_end,herb_mean,pred_mean,plants_mean,herb_min,pred_min,herb_immigrants,pred_immigrants,herb_extinct_tick,pred_extinct_tick,herb_fov_deg,pred_fov_deg,checksum,seconds",
        fields.join(",")
    )?;
    let opt = |t: Option<u64>| t.map_or(String::new(), |t| t.to_string());
    for r in rows {
        let r = r?;
        let values: Vec<String> = axes
            .iter()
            .zip(&combos[r.variant])
            .map(|(axis, &i)| axis.values[i].to_string().replace('"', ""))
            .collect();
        let e = &r.end;
        writeln!(
            out,
            "{},{},{},{},{},{},{},{:.1},{:.1},{:.1},{},{},{},{},{},{},{:.1},{:.1},{:016x},{:.1}",
            r.variant,
            values.join(","),
            r.seed,
            a.ticks,
            e.species[0].count,
            e.species[1].count,
            e.plants,
            r.herb_mean,
            r.pred_mean,
            r.plants_mean,
            r.herb_min,
            r.pred_min,
            e.totals[0].immigrants,
            e.totals[1].immigrants,
            opt(r.herb_extinct),
            opt(r.pred_extinct),
            e.species[0].mean_fov_angle.to_degrees(),
            e.species[1].mean_fov_angle.to_degrees(),
            r.checksum,
            r.seconds,
        )?;
    }
    out.flush()?;
    eprintln!("done in {:.1}s", started.elapsed().as_secs_f32());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axes_parse_numbers_and_strings() {
        let a = parse_axis("plants.regrowth=6, 12,24").unwrap();
        assert_eq!(a.field, "plants.regrowth");
        let want: Vec<serde_json::Value> = vec![6.into(), 12.into(), 24.into()];
        assert_eq!(a.values, want);
        assert!(parse_axis("plants.regrowth").is_err());
        assert!(parse_axis("=1").is_err());
    }

    #[test]
    fn grid_is_the_cartesian_product() {
        let axes = vec![parse_axis("a=1,2").unwrap(), parse_axis("b=x,y,z").unwrap()];
        let g = grid(&axes);
        assert_eq!(g.len(), 6);
        assert_eq!(g[0], vec![0, 0]);
        assert_eq!(g[1], vec![0, 1]);
        assert_eq!(g[5], vec![1, 2]);
        assert_eq!(grid(&[]), vec![Vec::<usize>::new()]);
    }

    #[test]
    fn set_field_rejects_unknown_paths_and_the_config_validates_values() {
        let mut json = serde_json::to_value(Config::default()).unwrap();
        set_field(&mut json, "plants.regrowth", &24.into()).unwrap();
        let cfg: Config = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(cfg.plants.regrowth, 24.0);
        assert!(set_field(&mut json, "plants.regrowt", &1.into()).is_err());
        set_field(&mut json, "plants.capacity", &0.into()).unwrap();
        let cfg: Config = serde_json::from_value(json).unwrap();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn sweep_summary_covers_the_second_half() {
        let mut cfg = Config::default();
        cfg.world.initial_herbivores = 80;
        cfg.world.initial_predators = 8;
        cfg.plants.initial = 300;
        let (end, row) = sweep_one(cfg, 3, 400, 100).unwrap();
        assert_eq!(end.tick, 400);
        assert!(row.herb_mean > 0.0);
        assert!(row.herb_min <= end.species[0].count.max(row.herb_min));
        assert_eq!(row.seed, 3);
    }
}
