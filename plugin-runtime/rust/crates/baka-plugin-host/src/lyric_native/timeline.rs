//! Pure native timeline: overlapping vocals retain the earliest active anchor.
use super::Line;
#[derive(Debug, PartialEq)]
pub struct State {
    pub active: Vec<usize>,
    pub anchor: Option<usize>,
}
pub fn at(lines: &[Line], seconds: f64) -> State {
    let active: Vec<_> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.time <= seconds && seconds < l.end_time)
        .map(|(i, _)| i)
        .collect();
    let anchor = active
        .iter()
        .copied()
        .find(|i| !lines[*i].is_bg)
        .or_else(|| active.first().copied())
        .or_else(|| lines.iter().rposition(|l| l.time <= seconds));
    State { active, anchor }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlapping() {
        let lines = vec![
            Line {
                time: 1.,
                end_time: 4.,
                ..Default::default()
            },
            Line {
                time: 2.,
                end_time: 3.,
                ..Default::default()
            },
        ];
        assert_eq!(
            at(&lines, 2.5),
            State {
                active: vec![0, 1],
                anchor: Some(0)
            }
        );
        assert_eq!(at(&lines, 0.).anchor, None);
    }
}
