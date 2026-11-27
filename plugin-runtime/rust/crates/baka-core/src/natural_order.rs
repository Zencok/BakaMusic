//! Deterministic, case-sensitive natural order with arbitrary-length ASCII numbers.
//! No locale, path normalization or integer parsing; original text breaks numeric ties.
use std::cmp::Ordering;

pub fn compare(a: &str, b: &str) -> Ordering {
    let (left, right) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        if left[i].is_ascii_digit() && right[j].is_ascii_digit() {
            let (start_i, start_j) = (i, j);
            while i < left.len() && left[i].is_ascii_digit() {
                i += 1;
            }
            while j < right.len() && right[j].is_ascii_digit() {
                j += 1;
            }
            let mut x = start_i;
            let mut y = start_j;
            while x < i && left[x] == b'0' {
                x += 1;
            }
            while y < j && right[y] == b'0' {
                y += 1;
            }
            let order = (i - x)
                .cmp(&(j - y))
                .then_with(|| left[x..i].cmp(&right[y..j]));
            if order != Ordering::Equal {
                return order;
            }
        } else {
            let order = left[i].cmp(&right[j]);
            if order != Ordering::Equal {
                return order;
            }
            i += 1;
            j += 1;
        }
    }
    (left.len() - i)
        .cmp(&(right.len() - j))
        .then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numbers_unicode_leading_zeros_and_long_runs_have_total_order() {
        let mut values = vec!["专辑10", "专辑2", "专辑02", "专辑1", "", "专辑000", "专辑0"];
        values.sort_by(|a, b| compare(a, b));
        assert_eq!(
            values,
            vec!["", "专辑0", "专辑000", "专辑1", "专辑02", "专辑2", "专辑10"]
        );
        assert_eq!(
            compare(
                &format!("a{}", "9".repeat(200)),
                &format!("a1{}", "0".repeat(200))
            ),
            Ordering::Less
        );
        for a in &values {
            for b in &values {
                assert_eq!(compare(a, b), compare(b, a).reverse());
                for c in &values {
                    if compare(a, b) != Ordering::Greater && compare(b, c) != Ordering::Greater {
                        assert_ne!(compare(a, c), Ordering::Greater);
                    }
                }
            }
        }
        assert_eq!(compare("disc2/track9", "disc2/track10"), Ordering::Less);
        assert_eq!(compare("A2", "a1"), Ordering::Less);
    }
}
