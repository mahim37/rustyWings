use core::fmt;

/// Every failure this crate can report. All variants carry enough context to
/// show a human a useful message, because the browser surfaces them directly.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum Error {
    /// A configuration field is out of range or inconsistent with another.
    InvalidConfig {
        /// Dotted path of the offending field, e.g. `herbivore.max_speed.max`.
        field: &'static str,
        /// Why it was rejected.
        reason: String,
    },
    /// A genome's weight vector does not match the brain topology in the config.
    GenomeShape {
        /// Number of weights the topology requires.
        expected: usize,
        /// Number of weights the genome carried.
        actual: usize,
    },
    /// A snapshot could not be decoded, or was produced by an incompatible version.
    Snapshot(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::InvalidConfig { field, reason } => {
                write!(f, "invalid config `{field}`: {reason}")
            }
            Error::GenomeShape { expected, actual } => {
                write!(
                    f,
                    "genome has {actual} weights but the brain topology needs {expected}"
                )
            }
            Error::Snapshot(msg) => write!(f, "snapshot error: {msg}"),
        }
    }
}

impl std::error::Error for Error {}
