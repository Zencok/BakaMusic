use super::*;
use serde_json::{Value, json};

fn resource(provider: &str, id: Value) -> ResourceIdentity {
    ResourceIdentity::new(
        serde_json::from_value(json!({
            "providerId": provider, "kind": "music", "id": id
        }))
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn long_unicode_and_encrypted_ids_do_not_become_job_ids() {
    let raw = format!("{}\"\\?token=a:b|c", "密钥".repeat(200));
    assert!(raw.len() > 128);
    let identity = resource("org.bakamusic.qq", json!(raw));
    assert_eq!(Value::from(identity.entity().id().clone()), json!(raw));
    assert_eq!(identity.resource_key().len(), 69);
    let job = JobId::from_entropy([0xab; 16]);
    assert_eq!(job.as_str(), "dl2_abababababababababababababababab");
    assert_eq!(job.as_str().len(), 36);
    assert_eq!(JobId::parse(job.as_str()).unwrap(), job);
    // Re-enqueue after deletion requires fresh FFI entropy and a durable unique
    // constraint. Core cannot know the ledger's historical set of job IDs.
    assert_ne!(job, JobId::from_entropy([0xac; 16]));
}

#[test]
fn job_codec_rejects_noncanonical_and_embedded_resource_ids() {
    for raw in [
        "",
        "dl2_0",
        "dl2_ABABABABABABABABABABABABABABABAB",
        "dl2_gggggggggggggggggggggggggggggggg",
        " dl2_abababababababababababababababab",
    ] {
        assert!(JobId::parse(raw).is_err(), "{raw}");
    }
    assert!(serde_json::from_value::<JobId>(json!(42)).is_err());
}

#[test]
fn canonical_numeric_identity_reuses_entity_contract() {
    let integer = resource("org.bakamusic.qq", json!(7));
    for raw in ["7.0", "7e0"] {
        assert_eq!(
            integer,
            resource("org.bakamusic.qq", serde_json::from_str(raw).unwrap())
        );
    }
    assert_eq!(
        integer.canonical_json(),
        r#"["baka.download.resource",2,"org.bakamusic.qq","music",["n",7]]"#
    );
    assert_ne!(
        integer.resource_key(),
        resource("org.bakamusic.qq", json!("7")).resource_key()
    );
    assert_ne!(
        integer.resource_key(),
        resource("org.bakamusic.other", json!(7)).resource_key()
    );
}

#[test]
fn canonical_tuple_escapes_strings_and_preserves_unicode() {
    let a = resource("org.bakamusic.qq", json!("a:b|c"));
    let b = resource("org.bakamusic.qq", json!("a|b:c"));
    assert_ne!(a.resource_key(), b.resource_key());
    let quoted = resource("org.bakamusic.qq", json!("\"], [\"n\",7"));
    let tuple: Value = serde_json::from_str(quoted.canonical_json()).unwrap();
    assert_eq!(tuple[4], json!(["s", "\"], [\"n\",7"]));
    assert_ne!(
        resource("org.bakamusic.qq", json!("é")).resource_key(),
        resource("org.bakamusic.qq", json!("e\u{301}")).resource_key()
    );
    assert_ne!(
        resource("org.bakamusic.qq", json!(" 7")).resource_key(),
        resource("org.bakamusic.qq", json!("7")).resource_key()
    );
    // Standard SHA-256 vector locks the hashing algorithm independently of JSON.
    use sha2::{Digest, Sha256};
    let expected = format!("res2_{:x}", Sha256::digest(a.canonical_json().as_bytes()));
    assert_eq!(a.resource_key(), expected);
}

#[test]
fn request_deduplication_keeps_audio_single_and_video_quality_distinct() {
    let identity = resource("org.bakamusic.qq", json!("7"));
    let audio = identity.request_key(&DownloadRequestKind::Audio);
    let low = identity.request_key(&DownloadRequestKind::Video {
        quality: "720p".into(),
    });
    let high = identity.request_key(&DownloadRequestKind::Video {
        quality: "1080p".into(),
    });
    assert_ne!(audio, low);
    assert_ne!(low, high);
    assert_eq!(audio, identity.request_key(&DownloadRequestKind::Audio));
}

#[test]
fn sequence_codec_covers_u64_and_forbids_lossy_inputs() {
    for value in [0, 1, 9, 10, (1u64 << 53) + 1, u64::MAX] {
        let seq = Sequence::new(value);
        assert_eq!(Sequence::parse(&value.to_string()).unwrap(), seq);
        assert_eq!(serde_json::to_value(seq).unwrap(), json!(value.to_string()));
        assert_eq!(
            serde_json::from_value::<Sequence>(json!(value.to_string())).unwrap(),
            seq
        );
    }
    for raw in [
        "",
        "00",
        "01",
        "+1",
        "-1",
        "1.0",
        "1e0",
        " 1",
        "1 ",
        "18446744073709551616",
        "١",
    ] {
        assert!(Sequence::parse(raw).is_err(), "{raw}");
    }
    assert!(serde_json::from_value::<Sequence>(json!(1)).is_err());
    assert_eq!(Sequence::new(9).checked_next().unwrap(), Sequence::new(10));
    assert!(Sequence::new(10) > Sequence::new(9));
    assert_eq!(
        Sequence::new(u64::MAX).checked_next(),
        Err(DownloadIdentityError::CounterExhausted)
    );
}

#[test]
fn terminal_progress_and_stale_operation_events_are_rejected() {
    for phase in [
        DownloadPhase::Completed,
        DownloadPhase::Failed,
        DownloadPhase::Cancelled,
    ] {
        assert!(phase.is_terminal());
        assert!(!phase.accepts_progress());
        assert!(!phase.can_transition_to(DownloadPhase::Transferring));
    }
    let fence = EventFence {
        task_id: JobId::from_entropy([1; 16]),
        generation: Sequence::new(1),
        operation_seq: Sequence::new(1),
    };
    assert!(fence.matches(&fence));
    assert!(!fence.matches(&EventFence {
        generation: Sequence::new(2),
        ..fence.clone()
    }));
    assert!(!fence.matches(&EventFence {
        operation_seq: Sequence::new(2),
        ..fence.clone()
    }));
    assert!(!fence.matches(&EventFence {
        task_id: JobId::from_entropy([2; 16]),
        ..fence
    }));
}

#[test]
fn retries_share_budget_and_restore_does_not_reset_it() {
    let mut budget = RetryBudget::new(3);
    assert!(budget.consume(RetryKind::SignatureRefresh));
    let snapshot = budget;
    assert!(!budget.consume(RetryKind::SignatureRefresh));
    assert_eq!(budget, snapshot);
    let mut restored: RetryBudget =
        serde_json::from_value(serde_json::to_value(budget).unwrap()).unwrap();
    assert!(restored.consume(RetryKind::IntegrityRestart));
    assert!(!restored.consume(RetryKind::Transient));
    assert!(restored.consume(RetryKind::QualityFallback));
    assert!(restored.consume(RetryKind::QualityFallback));
    assert!(!restored.consume(RetryKind::QualityFallback));
    assert!(!RetryBudget::new(0).consume(RetryKind::QualityFallback));
}
