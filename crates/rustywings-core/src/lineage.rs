//! Who begat whom.
//!
//! Living birds only know their parent's id, and the parent is usually long
//! dead by the time anyone asks. This log keeps one small record per bird
//! ever born so the inspector can walk a bird's ancestry, list its chicks and
//! count its living descendants. It is compacted now and then to the records
//! still reachable from a living bird, so memory follows the population, not
//! the age of the world.
//!
//! Nothing here touches the RNG or the simulation state, so the log never
//! affects a checksum. It is serialised with the world, so a restored
//! snapshot answers the same questions.

use serde::{Deserialize, Serialize};

use crate::agents::Species;

/// How a bird died.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cause {
    /// Ran out of energy.
    Starved,
    /// Reached the species' maximum age.
    Aged,
    /// Eaten by a hawk.
    Predated,
    /// Removed by a meteor strike.
    Struck,
}

/// One bird's entry in the log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    /// Unique id.
    pub id: u64,
    /// Parent id, or 0 for founders and immigrants.
    pub parent: u64,
    /// Kind.
    pub species: Species,
    /// Founders are generation 0.
    pub generation: u32,
    /// Tick of birth.
    pub born: u64,
    /// Tick of death, once dead.
    pub died: Option<u64>,
    /// Cause of death, once dead.
    pub cause: Option<Cause>,
    /// Chicks produced over its life.
    pub children: u32,
}

impl Record {
    /// Ticks lived so far, or over its whole life.
    pub fn lifespan(&self, now: u64) -> u64 {
        self.died.unwrap_or(now).saturating_sub(self.born)
    }
}

/// Answers about one bird's family.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Family {
    /// The bird itself.
    pub subject: Record,
    /// Parent first, then grandparent, and so on as far as the log reaches.
    pub ancestors: Vec<Record>,
    /// Chicks still in the log (living ones, and dead ones until compaction).
    pub children: Vec<Record>,
    /// Living birds descended from the subject.
    pub living_descendants: u32,
}

/// Compaction runs every this many ticks, when the log is large.
pub(crate) const COMPACT_EVERY: u64 = 4096;
/// Below this many records compaction is not worth the pass.
pub(crate) const COMPACT_ABOVE: usize = 8192;

/// Append-only log, sorted by id (ids are handed out in increasing order).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Lineage {
    records: Vec<Record>,
}

impl Lineage {
    /// Records currently held.
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// `true` when nothing has been born yet.
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Every record, oldest first.
    pub fn records(&self) -> &[Record] {
        &self.records
    }

    fn position(&self, id: u64) -> Option<usize> {
        let i = self.records.partition_point(|r| r.id < id);
        (i < self.records.len() && self.records[i].id == id).then_some(i)
    }

    /// The record for `id`, if it is still in the log.
    pub fn get(&self, id: u64) -> Option<&Record> {
        self.position(id).map(|i| &self.records[i])
    }

    pub(crate) fn birth(
        &mut self,
        id: u64,
        parent: u64,
        species: Species,
        generation: u32,
        tick: u64,
    ) {
        debug_assert!(self.records.last().is_none_or(|r| r.id < id));
        if parent != 0 {
            if let Some(i) = self.position(parent) {
                self.records[i].children += 1;
            }
        }
        self.records.push(Record {
            id,
            parent,
            species,
            generation,
            born: tick,
            died: None,
            cause: None,
            children: 0,
        });
    }

    pub(crate) fn death(&mut self, id: u64, tick: u64, cause: Cause) {
        if let Some(i) = self.position(id) {
            self.records[i].died = Some(tick);
            self.records[i].cause = Some(cause);
        }
    }

    /// Parent, grandparent, ... for as long as the log has them.
    pub fn ancestors(&self, id: u64) -> impl Iterator<Item = &Record> {
        let mut next = self.get(id).map(|r| r.parent).unwrap_or(0);
        core::iter::from_fn(move || {
            if next == 0 {
                return None;
            }
            let r = self.get(next)?;
            next = r.parent;
            Some(r)
        })
    }

    /// `true` when `ancestor` is `id` itself or somewhere up its chain.
    fn descends_from(&self, id: u64, ancestor: u64) -> bool {
        id == ancestor || self.ancestors(id).any(|r| r.id == ancestor)
    }

    /// Everything the inspector shows about `id`. `living` is the id list of
    /// the birds currently alive.
    pub fn family(&self, id: u64, living: &[u64]) -> Option<Family> {
        let subject = *self.get(id)?;
        let ancestors = self.ancestors(id).copied().collect();
        let children = self
            .records
            .iter()
            .filter(|r| r.parent == id)
            .copied()
            .collect();
        let living_descendants = living
            .iter()
            .filter(|&&v| v != id && self.descends_from(v, id))
            .count() as u32;
        Some(Family {
            subject,
            ancestors,
            children,
            living_descendants,
        })
    }

    /// Living birds that share `id`'s grandparent (or its nearest recorded
    /// ancestor when the chain is shorter), plus `id`'s living ancestors.
    /// This is what the map highlights as a bird's relatives; `id` itself is
    /// included when alive. Sorted ascending.
    pub fn relatives(&self, id: u64, living: &[u64]) -> Vec<u64> {
        let Some(subject) = self.get(id) else {
            return Vec::new();
        };
        let root = self
            .ancestors(id)
            .take(2)
            .last()
            .map_or(subject.id, |r| r.id);
        let mut out: Vec<u64> = living
            .iter()
            .copied()
            .filter(|&v| self.descends_from(v, root) || self.descends_from(id, v))
            .collect();
        out.sort_unstable();
        out
    }

    /// Keep only the records of living birds and their ancestors. `living`
    /// need not be sorted.
    pub(crate) fn compact(&mut self, living: &[u64]) {
        let mut keep = vec![false; self.records.len()];
        for &id in living {
            let mut next = id;
            while next != 0 {
                let Some(i) = self.position(next) else { break };
                if keep[i] {
                    break;
                }
                keep[i] = true;
                next = self.records[i].parent;
            }
        }
        let mut i = 0;
        self.records.retain(|_| {
            let k = keep[i];
            i += 1;
            k
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log() -> Lineage {
        // 1 (founder) -> 2 -> 4; 1 -> 3; 5 is an unrelated founder.
        let mut l = Lineage::default();
        l.birth(1, 0, Species::Herbivore, 0, 0);
        l.birth(2, 1, Species::Herbivore, 1, 100);
        l.birth(3, 1, Species::Herbivore, 1, 120);
        l.birth(4, 2, Species::Herbivore, 2, 300);
        l.birth(5, 0, Species::Predator, 0, 0);
        l.death(1, 900, Cause::Aged);
        l.death(2, 400, Cause::Predated);
        l
    }

    #[test]
    fn records_births_deaths_and_child_counts() {
        let l = log();
        let one = l.get(1).unwrap();
        assert_eq!(one.children, 2);
        assert_eq!(one.died, Some(900));
        assert_eq!(one.cause, Some(Cause::Aged));
        assert_eq!(one.lifespan(5000), 900);
        assert_eq!(l.get(4).unwrap().lifespan(5000), 4700);
        assert!(l.get(9).is_none());
    }

    #[test]
    fn walks_ancestors_and_counts_descendants() {
        let l = log();
        let chain: Vec<u64> = l.ancestors(4).map(|r| r.id).collect();
        assert_eq!(chain, vec![2, 1]);
        let living = [3, 4, 5];
        let f = l.family(1, &living).unwrap();
        assert_eq!(f.living_descendants, 2);
        assert_eq!(
            f.children.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![2, 3]
        );
        let f = l.family(4, &living).unwrap();
        assert_eq!(f.living_descendants, 0);
        assert_eq!(f.ancestors.len(), 2);
        assert!(l.family(42, &living).is_none());
    }

    #[test]
    fn relatives_share_a_grandparent() {
        let l = log();
        let living = [3, 4, 5];
        // 4's grandparent is 1, whose living descendants are 3 and 4.
        assert_eq!(l.relatives(4, &living), vec![3, 4]);
        // 5 is a founder with no relatives but itself.
        assert_eq!(l.relatives(5, &living), vec![5]);
        assert!(l.relatives(9, &living).is_empty());
    }

    #[test]
    fn compaction_keeps_living_birds_and_their_ancestors() {
        let mut l = log();
        l.compact(&[4]);
        let ids: Vec<u64> = l.records().iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![1, 2, 4]);
        assert_eq!(l.ancestors(4).count(), 2, "the chain survives compaction");
        l.compact(&[]);
        assert!(l.is_empty());
    }

    #[test]
    fn survives_a_postcard_round_trip() {
        let l = log();
        let bytes = postcard::to_allocvec(&l).unwrap();
        let back: Lineage = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(back.records(), l.records());
    }
}
