//! Conservative album candidates, not persistent album identities or relink evidence.
//! Platform adapters supply opaque directory IDs; never derive them from content URIs.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlbumContext {
    pub source_id: String,
    pub asset_id: String,
    /// Source-scoped parent directory identity, only when known by the adapter.
    pub directory_id: Option<String>,
    pub album: Option<String>,
    pub album_artists: Vec<String>,
    pub edition: Option<String>,
    pub release_date: Option<String>,
}

/// Structured keys avoid delimiter collisions. Never persist this as an album ID:
/// tag edits change candidates; user collections must retain independent IDs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AlbumCandidate {
    Tagged {
        source_id: String,
        album: String,
        album_artists: Vec<String>,
        edition: Option<String>,
        release_date: Option<String>,
    },
    Directory {
        source_id: String,
        directory_id: String,
        album: Option<String>,
        album_artists: Vec<String>,
        edition: Option<String>,
        release_date: Option<String>,
    },
    Asset {
        source_id: String,
        asset_id: String,
    },
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("local_album_invalid_context")]
pub struct InvalidAlbumContext;

// Deliberately only Unicode lowercase and whitespace folding. No punctuation
// removal, fuzzy matching, transliteration, date guessing or artist alias merge.
fn normalized(value: &str) -> Option<String> {
    let value = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    (!value.is_empty()).then_some(value)
}

pub fn candidate(context: &AlbumContext) -> Result<AlbumCandidate, InvalidAlbumContext> {
    let bounded = |s: &str| s.chars().count() <= 4096;
    let identity = |s: &str| bounded(s) && !s.trim().is_empty();
    if !identity(&context.source_id)
        || !identity(&context.asset_id)
        || context
            .directory_id
            .as_deref()
            .is_some_and(|s| !identity(s))
        || context.album_artists.len() > 32
        || context.album_artists.iter().any(|s| !bounded(s))
        || [&context.album, &context.edition, &context.release_date]
            .into_iter()
            .flatten()
            .any(|s| !bounded(s))
    {
        return Err(InvalidAlbumContext);
    }
    let album = context.album.as_deref().and_then(normalized);
    let mut album_artists: Vec<_> = context
        .album_artists
        .iter()
        .filter_map(|s| normalized(s))
        .collect();
    album_artists.sort();
    album_artists.dedup();
    let edition = context.edition.as_deref().and_then(normalized);
    let release_date = context.release_date.as_deref().and_then(normalized);
    if let Some(album) = album.as_ref().filter(|_| !album_artists.is_empty()) {
        return Ok(AlbumCandidate::Tagged {
            source_id: context.source_id.clone(),
            album: album.clone(),
            album_artists,
            edition,
            release_date,
        });
    }
    if let Some(directory_id) = &context.directory_id {
        return Ok(AlbumCandidate::Directory {
            source_id: context.source_id.clone(),
            directory_id: directory_id.clone(),
            album,
            album_artists,
            edition,
            release_date,
        });
    }
    Ok(AlbumCandidate::Asset {
        source_id: context.source_id.clone(),
        asset_id: context.asset_id.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> AlbumContext {
        AlbumContext {
            source_id: "source".into(),
            asset_id: "track-one".into(),
            directory_id: Some("disc-one".into()),
            album: Some(" Album  Name ".into()),
            album_artists: vec!["Various Artists".into()],
            edition: None,
            release_date: None,
        }
    }

    #[test]
    fn tagged_multidisc_compilation_ignores_file_and_directory() {
        let first = context();
        let mut second = first.clone();
        second.asset_id = "track-two".into();
        second.directory_id = Some("disc-two".into());
        second.album = Some("album\tNAME".into());
        second.album_artists = vec![" various artists ".into(), "VARIOUS ARTISTS".into()];
        assert_eq!(candidate(&first), candidate(&second));
        // Track artists and disc/track numbers are intentionally not key inputs.
        assert!(matches!(
            candidate(&first).unwrap(),
            AlbumCandidate::Tagged { .. }
        ));
    }

    #[test]
    fn artist_release_edition_and_source_separate_candidates() {
        let first = context();
        for changed in 0..4 {
            let mut other = first.clone();
            match changed {
                0 => other.album_artists = vec!["Another Artist".into()],
                1 => other.release_date = Some("2026".into()),
                2 => other.edition = Some("Deluxe".into()),
                _ => other.source_id = "another-source".into(),
            }
            assert_ne!(candidate(&first), candidate(&other));
        }
    }

    #[test]
    fn missing_tags_use_opaque_directory_then_asset_not_unknown_bucket() {
        let mut first = context();
        first.album_artists.clear();
        assert!(matches!(
            candidate(&first).unwrap(),
            AlbumCandidate::Directory { .. }
        ));
        let mut other = first.clone();
        other.directory_id = Some("disc-two".into());
        assert_ne!(candidate(&first), candidate(&other));
        other.directory_id = Some("DISC-ONE".into());
        assert_ne!(candidate(&first), candidate(&other));
        first.album = Some("  ".into());
        other = first.clone();
        other.asset_id = "track-two".into();
        assert_eq!(candidate(&first), candidate(&other));
        first.directory_id = None;
        other.directory_id = None;
        assert_ne!(candidate(&first), candidate(&other));
        assert!(matches!(
            candidate(&first).unwrap(),
            AlbumCandidate::Asset { .. }
        ));
    }

    #[test]
    fn same_directory_does_not_discard_known_tags_or_release_clues() {
        let mut first = context();
        first.album_artists.clear();
        let mut other = first.clone();
        other.album = Some("Another Album".into());
        assert_ne!(candidate(&first), candidate(&other));
        other = first.clone();
        other.edition = Some("Live".into());
        assert_ne!(candidate(&first), candidate(&other));
    }

    #[test]
    fn keys_roundtrip_without_separator_collisions() {
        let mut first = context();
        first.album_artists = vec!["A / B".into()];
        let mut other = first.clone();
        other.album_artists = vec!["A".into(), "B".into()];
        assert_ne!(candidate(&first), candidate(&other));
        other.album_artists.reverse();
        let key = candidate(&other).unwrap();
        let encoded = serde_json::to_string(&key).unwrap();
        assert_eq!(
            serde_json::from_str::<AlbumCandidate>(&encoded).unwrap(),
            key
        );
        other.album_artists.reverse();
        assert_eq!(candidate(&other).unwrap(), key);
    }

    #[test]
    fn invalid_or_unbounded_context_is_rejected() {
        for field in 0..5 {
            let mut input = context();
            match field {
                0 => input.source_id.clear(),
                1 => input.asset_id = " ".into(),
                2 => input.directory_id = Some("".into()),
                3 => input.album = Some("x".repeat(4097)),
                _ => input.album_artists = vec!["artist".into(); 33],
            }
            assert_eq!(candidate(&input), Err(InvalidAlbumContext));
        }
    }
}
