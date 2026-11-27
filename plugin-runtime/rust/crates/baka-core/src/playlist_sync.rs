//! Pure O(n) membership planning. SQLite I/O and plugin execution stay outside.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub provider_id: String,
    pub input: String,
}
impl Source {
    fn key(&self) -> String {
        json!([self.provider_id, self.input.trim()]).to_string()
    }
}
pub fn sources(value: Value) -> Result<Vec<Source>, String> {
    let mut sources: Vec<Source> = serde_json::from_value(value).map_err(|e| e.to_string())?;
    if sources.len() > 100 {
        return Err("Too many import sources".into());
    }
    let mut seen = HashSet::new();
    for source in &mut sources {
        source.input = source.input.trim().to_owned();
        if [&source.provider_id, &source.input]
            .iter()
            .any(|s| s.trim().is_empty() || s.len() > 4000)
            || !seen.insert(source.key())
        {
            return Err("Invalid or duplicate import source".into());
        }
    }
    Ok(sources)
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
struct Row {
    platform: String,
    track_key: String,
    track_json: String,
    position: i64,
    #[serde(default = "manual_default")]
    manual: i64,
    #[serde(default = "empty_keys")]
    source_keys: String,
}
fn manual_default() -> i64 {
    1
}
fn empty_keys() -> String {
    "[]".into()
}
type Key = (String, String);
fn key(row: &Row) -> Key {
    (row.platform.clone(), row.track_key.clone())
}
fn track_key(track: &Value) -> Result<Key, String> {
    let platform = track["platform"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Missing track platform")?;
    let id = crate::plugin_contract::EntityId::try_from(track["id"].clone()).map_err(|e|e.to_string())?;
    let id = json!(["music",Value::from(id)]).to_string();
    Ok((platform.to_owned(), id))
}

/// Preserve local order, prepend genuinely new tracks in source order. Unchanged
/// rows retain positions and JSON bytes: zero writes on identical snapshots.
/// `partial` is for additive re-import; deletion requires all source snapshots.
pub fn plan(input: &Value) -> Result<Value, String> {
    let sources = sources(input["sources"].clone())?;
    let expected: HashSet<_> = sources.iter().map(Source::key).collect();
    // Deserialize from the request without first duplicating its JSON tree.
    let existing: Vec<Row> = Vec::deserialize(&input["existing"]).map_err(|e| e.to_string())?;
    if existing.len() > 200_000 {
        return Err("Playlist too large".into());
    }
    let mut rows = existing.clone();
    let mut owners: Vec<BTreeSet<String>> = rows
        .iter()
        .map(|r| serde_json::from_str(&r.source_keys).map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;
    if owners.iter().flatten().any(|k| !expected.contains(k)) {
        return Err("Unknown ownership source".into());
    }
    let index: HashMap<Key, usize> = rows.iter().enumerate().map(|(i, r)| (key(r), i)).collect();
    if index.len() != rows.len() {
        return Err("Duplicate stored tracks".into());
    }
    if input["restore"] == true {
        let entries = input["ownership"].as_array().ok_or("Invalid ownership")?;
        if entries.len() > 200_000 {
            return Err("Too much ownership data".into());
        }
        let mut seen = HashSet::new();
        for entry in entries {
            let k = track_key(entry)?;
            if !seen.insert(k.clone()) {
                return Err("Duplicate ownership".into());
            }
            let manual = entry["manual"].as_bool().ok_or("Invalid manual flag")?;
            let keys: BTreeSet<String> =
                serde_json::from_value(entry["sourceKeys"].clone()).map_err(|e| e.to_string())?;
            if keys.iter().any(|k| !expected.contains(k)) || (!manual && keys.is_empty()) {
                return Err("Invalid ownership sources".into());
            }
            if let Some(&i) = index.get(&k) {
                rows[i].manual = i64::from(manual);
                owners[i] = keys;
            }
        }
    } else {
        let snapshots = input["snapshots"].as_array().ok_or("Invalid snapshots")?;
        let partial = input["partial"] == true;
        let mut received = HashSet::new();
        // The request outlives planning. Keep only references to snapshot metadata;
        // serialize it only when a row actually needs inserting or updating.
        let mut incoming: Vec<(Key, &Value, BTreeSet<String>)> = Vec::new();
        let mut incoming_index = HashMap::new();
        for snapshot in snapshots {
            let source: Source =
                serde_json::from_value(snapshot["source"].clone()).map_err(|e| e.to_string())?;
            let source_key = source.key();
            if !expected.contains(&source_key) || !received.insert(source_key.clone()) {
                return Err("Unexpected snapshot".into());
            }
            let tracks = snapshot["musicList"]
                .as_array()
                .ok_or("Invalid snapshot tracks")?;
            for track in tracks {
                let k = track_key(track)?;
                if let Some(&i) = incoming_index.get(&k) {
                    let entry: &mut (Key, &Value, BTreeSet<String>) = &mut incoming[i];
                    entry.2.insert(source_key.clone());
                } else {
                    incoming_index.insert(k.clone(), incoming.len());
                    incoming.push((k, track, BTreeSet::from([source_key.clone()])));
                }
            }
        }
        if (!partial && (received != expected || expected.is_empty())) || incoming.len() > 200_000 {
            return Err("Incomplete snapshots or oversized playlist".into());
        }
        if !partial {
            for owner in &mut owners {
                owner.clear();
            }
        }
        let min = rows.iter().map(|r| r.position).min().unwrap_or(0);
        let mut position = min
            .checked_sub(incoming.len() as i64)
            .ok_or("Position overflow")?;
        for (k, track, source_keys) in incoming {
            if let Some(&i) = index.get(&k) {
                // Semantic JSON equality avoids updates caused solely by key order.
                if serde_json::from_str::<Value>(&rows[i].track_json).map_err(|e| e.to_string())?
                    != *track
                {
                    rows[i].track_json = track.to_string();
                }
                owners[i].extend(source_keys);
            } else {
                rows.push(Row {
                    platform: k.0,
                    track_key: k.1,
                    track_json: track.to_string(),
                    position,
                    manual: 0,
                    source_keys: empty_keys(),
                });
                position += 1;
                owners.push(source_keys);
            }
        }
    }
    let mut inserted = Vec::new();
    let mut updated = Vec::new();
    let mut deleted = Vec::new();
    for (i, mut row) in rows.into_iter().enumerate() {
        row.source_keys = serde_json::to_string(&owners[i]).unwrap();
        if row.manual == 0 && owners[i].is_empty() {
            deleted.push(json!({"platform":row.platform,"track_key":row.track_key}));
        } else if i >= existing.len() {
            inserted.push(row);
        } else if row != existing[i] {
            updated.push(row);
        }
    }
    Ok(
        json!({"added": inserted.len(), "removed":deleted.len(), "total":existing.len()+inserted.len()-deleted.len(), "inserted":inserted,"updated":updated,"deleted":deleted}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> Value {
        json!({"providerId":"p","input":"link"})
    }
    fn row(id: Value, manual: i64) -> Value {
        json!({"platform":"p","track_key":json!(["music",id]).to_string(),"track_json":json!({"platform":"p","id":id}).to_string(),"position":0,"manual":manual,"source_keys":if manual == 0 {json!([json!(["p","link"]).to_string()]).to_string()} else {"[]".into()}})
    }
    fn request(existing: Value, tracks: Value) -> Value {
        json!({"sources":[source()],"existing":existing,"snapshots":[{"source":source(),"musicList":tracks}]})
    }
    #[test]
    fn dedup_and_manual_ownership() {
        let result = plan(&request(
            json!([row(json!(1), 0), row(json!("manual"), 1)]),
            json!([{"platform":"p","id":2},{"platform":"p","id":"2"}]),
        ))
        .unwrap();
        assert_eq!(result["added"], 2);
        assert_eq!(result["removed"], 1);
        assert_eq!(result["total"], 3);
        assert_eq!(
            serde_json::from_str::<Value>(result["inserted"][0]["track_json"].as_str().unwrap())
                .unwrap()["id"],
            2
        );
    }
    #[test]
    fn unchanged_has_zero_writes_and_empty_removes_only_imported() {
        let existing = json!([row(json!(1), 0), row(json!("manual"), 1)]);
        let result = plan(&request(existing.clone(), json!([{"platform":"p","id":1}]))).unwrap();
        for name in ["inserted", "updated", "deleted"] {
            assert_eq!(result[name], json!([]));
        }
        let result = plan(&request(existing, json!([]))).unwrap();
        assert_eq!(result["removed"], 1);
    }
    #[test]
    fn incomplete_and_invalid_rejected() {
        let mut input = request(json!([]), json!([]));
        input["snapshots"] = json!([]);
        assert!(plan(&input).is_err());
        assert!(plan(&request(json!([]), json!([{"id":1}]))).is_err());
    }

    #[test]
    fn nested_metadata_preserves_first_duplicate_and_unchanged_stored_bytes() {
        let track = json!({"platform":"p","id":1,"extra":{
            "lyrics":[null,"line",{"time":42}],"artwork":"cover","enabled":true
        }});
        let mut stored = row(json!(1), 0);
        let original = serde_json::to_string_pretty(&track).unwrap();
        stored["track_json"] = json!(original);
        let input = request(json!([stored.clone()]), json!([track.clone()]));
        let before = input.clone();
        assert_eq!(plan(&input).unwrap()["updated"], json!([]));
        assert_eq!(input, before);

        let mut changed = track.clone();
        changed["extra"]["lyrics"][1] = json!("changed");
        let update = plan(&request(
            json!([stored.clone()]),
            json!([changed.clone(), track.clone()]),
        ))
        .unwrap();
        let updated = &update["updated"][0];
        assert_eq!(
            serde_json::from_str::<Value>(updated["track_json"].as_str().unwrap()).unwrap(),
            changed
        );
        assert_eq!(updated["position"], stored["position"]);
        let insert = plan(&request(json!([]), json!([track.clone(), changed]))).unwrap();
        assert_eq!(insert["added"], 1);
        assert_eq!(
            serde_json::from_str::<Value>(insert["inserted"][0]["track_json"].as_str().unwrap())
                .unwrap(),
            track
        );
    }

    #[test]
    fn stored_rows_still_validate_types_defaults_and_duplicate_identity() {
        for invalid in [Value::Null, json!({}), json!([{"platform":42}])] {
            assert!(plan(&request(invalid, json!([]))).is_err());
        }
        let mut legacy = row(json!(1), 1);
        legacy.as_object_mut().unwrap().remove("manual");
        legacy.as_object_mut().unwrap().remove("source_keys");
        assert_eq!(
            plan(&request(json!([legacy.clone()]), json!([]))).unwrap()["total"],
            1
        );
        assert!(plan(&request(json!([legacy.clone(), legacy]), json!([]))).is_err());
        let mut corrupt = row(json!(1), 0);
        corrupt["track_json"] = json!("invalid JSON");
        assert!(plan(&request(json!([corrupt]), json!([{"platform":"p","id":1}]))).is_err());
    }
    #[test]
    fn large_identical_snapshot_has_no_delta() {
        let rows: Vec<_> = (0..50_000).map(|id| row(json!(id), 0)).collect();
        let tracks: Vec<_> = (0..50_000)
            .map(|id| json!({"platform":"p","id":id}))
            .collect();
        let result = plan(&request(json!(rows), json!(tracks))).unwrap();
        assert_eq!(result["total"], 50_000);
        for name in ["inserted", "updated", "deleted"] {
            assert_eq!(result[name], json!([]));
        }
    }

    #[test]
    #[ignore = "manual host timing; no wall-clock pass threshold"]
    fn playlist_sync_plan_measurement() {
        use std::{hint::black_box, time::Instant};

        for count in [5_000, 50_000] {
            let tracks: Vec<_> = (0..count)
                .map(|id| {
                    json!({
                        "platform":"p", "id":id, "title":format!("Track {id}"),
                        "artists":[{"name":"Artist"}], "album":{"name":"Album"},
                        "extra":{"qualities":["128k","320k","flac"],"duration":240}
                    })
                })
                .collect();
            let rows: Vec<_> = tracks
                .iter()
                .map(|track| {
                    let mut stored = row(track["id"].clone(), 0);
                    stored["track_json"] = json!(track.to_string());
                    stored
                })
                .collect();
            let input = request(json!(rows), json!(tracks));
            let expected = json!({"added":0,"removed":0,"total":count,
                "inserted":[],"updated":[],"deleted":[]});
            for _ in 0..3 {
                assert_eq!(plan(black_box(&input)).unwrap(), expected);
            }
            let mut samples = Vec::new();
            for _ in 0..7 {
                let start = Instant::now();
                let result = plan(black_box(&input)).unwrap();
                samples.push(start.elapsed());
                assert_eq!(result, expected);
                black_box(result);
            }
            samples.sort();
            eprintln!(
                "playlist sync {count} tracks: median {:.3} ms",
                samples[3].as_secs_f64() * 1000.
            );
        }
    }
    #[test]
    fn shared_track_survives_one_source_removal_and_partial_reimport_is_additive() {
        let a = source();
        let b = json!({"providerId":"p","input":"other"});
        let mut existing = row(json!(1), 0);
        existing["source_keys"] = json!(
            json!([
                json!(["p", "link"]).to_string(),
                json!(["p", "other"]).to_string()
            ])
            .to_string()
        );
        let mut input = json!({"sources":[a,b],"existing":[existing],"snapshots":[
            {"source":a,"musicList":[]}, {"source":b,"musicList":[{"platform":"p","id":1}]}
        ]});
        let result = plan(&input).unwrap();
        assert_eq!(result["removed"], 0);
        assert_eq!(result["updated"].as_array().unwrap().len(), 1);
        input["snapshots"] = json!([{ "source":a,"musicList":[] }]);
        assert!(plan(&input).is_err());
        input["partial"] = json!(true);
        let result = plan(&input).unwrap();
        assert_eq!(result["updated"], json!([]));
        assert_eq!(result["removed"], 0);
    }

    #[test]
    fn restore_validates_ownership_and_preserves_missing_legacy_entries() {
        let mut input = json!({"sources":[source()],"existing":[row(json!(1),1),row(json!(2),1)],"restore":true,
            "ownership":[{"platform":"p","id":1,"manual":false,"sourceKeys":[json!(["p","link"]).to_string()]}]});
        let result = plan(&input).unwrap();
        assert_eq!(result["updated"].as_array().unwrap().len(), 1);
        assert_eq!(result["updated"][0]["manual"], 0);
        input["ownership"][0]["sourceKeys"] = json!(["unknown"]);
        assert!(plan(&input).is_err());
    }

    #[test]
    fn distinct_platforms_do_not_collide_and_positions_remain_stable() {
        let mut old = row(json!(1), 0);
        old["position"] = json!(-100);
        let result = plan(&request(
            json!([old]),
            json!([
                {"platform":"p","id":1}, {"platform":"other","id":1}
            ]),
        ))
        .unwrap();
        assert_eq!(result["added"], 1);
        assert_eq!(result["updated"], json!([]));
        assert!(result["inserted"][0]["position"].as_i64().unwrap() < -100);
    }
}
