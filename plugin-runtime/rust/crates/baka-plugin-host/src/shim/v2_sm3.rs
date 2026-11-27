//! Native SM3 protocol hashing; same audited GB/T 32905 implementation used by LyraMesh.
// GB/T 32905 SM3, used by the v20.6 Medusa record.
pub fn sm3(message: &[u8]) -> [u8; 32] {
    fn rol(x: u32, n: u32) -> u32 {
        x.rotate_left(n & 31)
    }
    fn p0(x: u32) -> u32 {
        x ^ rol(x, 9) ^ rol(x, 17)
    }
    fn p1(x: u32) -> u32 {
        x ^ rol(x, 15) ^ rol(x, 23)
    }
    let bit_len = (message.len() as u64) * 8;
    let padded_len = (message.len() + 9).div_ceil(64) * 64;
    let mut padded = vec![0_u8; padded_len];
    padded[..message.len()].copy_from_slice(message);
    padded[message.len()] = 0x80;
    padded[padded_len - 8..].copy_from_slice(&bit_len.to_be_bytes());
    let mut state = [
        0x7380_166f,
        0x4914_b2b9,
        0x1724_42d7,
        0xda8a_0600,
        0xa96f_30bc,
        0x1631_38aa,
        0xe38d_ee4d,
        0xb0fb_0e4e,
    ];
    for block in padded.as_chunks::<64>().0.iter() {
        let mut w = [0_u32; 68];
        let mut w1 = [0_u32; 64];
        for (index, chunk) in block.as_chunks::<4>().0.iter().enumerate() {
            w[index] = u32::from_be_bytes(*chunk);
        }
        for index in 16..68 {
            w[index] = p1(w[index - 16] ^ w[index - 9] ^ rol(w[index - 3], 15))
                ^ rol(w[index - 13], 7)
                ^ w[index - 6];
        }
        for index in 0..64 {
            w1[index] = w[index] ^ w[index + 4];
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for index in 0..64 {
            let tj: u32 = if index < 16 { 0x79cc_4519 } else { 0x7a87_9d8a };
            let ss1 = rol(
                rol(a, 12)
                    .wrapping_add(e)
                    .wrapping_add(rol(tj, index as u32)),
                7,
            );
            let ss2 = ss1 ^ rol(a, 12);
            let ff = if index < 16 {
                a ^ b ^ c
            } else {
                (a & b) | (a & c) | (b & c)
            };
            let gg = if index < 16 {
                e ^ f ^ g
            } else {
                (e & f) | ((!e) & g)
            };
            let tt1 = ff.wrapping_add(d).wrapping_add(ss2).wrapping_add(w1[index]);
            let tt2 = gg.wrapping_add(h).wrapping_add(ss1).wrapping_add(w[index]);
            d = c;
            c = rol(b, 9);
            b = a;
            a = tt1;
            h = g;
            g = rol(f, 19);
            f = e;
            e = p0(tt2);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot ^= value;
        }
    }
    let mut out = [0_u8; 32];
    for (index, value) in state.iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sm3_abc() {
        assert_eq!(
            hex::encode(sm3(b"abc")),
            "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0"
        );
    }
}
