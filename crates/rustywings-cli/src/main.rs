//! `rustywings`: the headless side of the project.
//!
//! The same crate that runs in the browser runs here, natively and in
//! parallel, which is what makes the CI checks meaningful: `verify` pins a
//! checksum so any change to the simulation is deliberate, and `arena` proves
//! that evolved brains beat random ones.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
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
    #[arg(long, default_value_t = 1)]
    seed: u64,
    /// Ticks to simulate.
    #[arg(long, default_value_t = 20_000)]
    ticks: u64,
    /// Emit a stats row every N ticks.
    #[arg(long, default_value_t = 250)]
    every: u64,
    /// JSON config file (see `rustywings config`).
    #[arg(long)]
    config: Option<PathBuf>,
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
    /// Total birds to start with (90% sparrows, 10% hawks).
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
    #[arg(long, default_value_t = 1)]
    seed: u64,
    #[arg(long, default_value_t = 2000)]
    ticks: u64,
    /// Expected checksum (hex). Exit 1 on mismatch.
    #[arg(long)]
    expect: Option<String>,
    #[arg(long)]
    config: Option<PathBuf>,
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

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Run(a) => run(a),
        Cmd::Bench(a) => bench(a),
        Cmd::Verify(a) => verify(a),
        Cmd::Arena(a) => arena(a),
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
    let cfg = load_config(&a.config)?;
    let mut world = World::new(cfg, a.seed)?;
    let mut out: Box<dyn Write> = match &a.out {
        Some(p) => Box::new(BufWriter::new(
            File::create(p).with_context(|| format!("creating {}", p.display()))?,
        )),
        None => Box::new(BufWriter::new(std::io::stdout().lock())),
    };
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
        "seed {} · {} ticks in {:.1}s · herbivores {} · predators {} · plants {} · checksum {:016x}",
        a.seed,
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
    let cfg = load_config(&a.config)?;
    let mut world = World::new(cfg, a.seed)?;
    world.run(a.ticks);
    let sum = world.checksum();
    println!("{sum:016x}");
    if let Some(expect) = a.expect {
        let want = u64::from_str_radix(expect.trim().trim_start_matches("0x"), 16)
            .context("--expect must be hex")?;
        if want != sum {
            bail!("checksum mismatch: expected {want:016x}, got {sum:016x}");
        }
        eprintln!("ok: seed {} · {} ticks · checksum matches", a.seed, a.ticks);
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
