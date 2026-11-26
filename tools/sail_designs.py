"""Sail designs for the viewer, from the Wills Wing colour picker (issue #48).

The picker draws each design as a plan view of the top and of the bottom of the sail (an SVG with
one group per colour zone: P1 leading edge, P4 trailing edge, P5 undersurface, ...) and lists the
fabrics each zone can have (models.json). The drawings are not to scale, so this tool resamples
each one into cloth coordinates: s the share of the half span (0 at the keel, 1 at the tip) and t
the share of the chord between the leading and the trailing edge at that span. The viewer works
out the same (s, t) for every vertex of the 3D sail and colours it from these maps.

The zone outlines are read as vectors from the SVG paths, so the edges are exact. For every
design and side it writes viewer/public/designs/<glider>/:
- <design>-<side>.png: the zone's number per texel (8-bit), for inside the zones;
- <design>-<side>-sdf<i>.png: each zone's signed distance to its edge, one zone per channel (four per
  image), so the viewer draws every edge sharp and smooth at any zoom;
and designs.json (zones and fabrics per design). The leading edge (P1) is left out of the maps:
the viewer colours the model's own leading-edge cloth with it. The Wills Wing files are downloaded into
tools/.cache and are not committed.

    python3 tools/sail_designs.py            # needs rsvg-convert, ImageMagick (magick) and numpy
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", "willswing")
OUT = os.environ.get("DESIGNS_OUT") or os.path.join(HERE, "..", "viewer", "public", "designs")   # (a trial copy first)
SITE = "https://www.willswing.com"
PICKER = "/assets/data/color-picker/models.json"
NS, NT = 2048, 1024           # cloth maps: span texels (keel to tip) x chord texels (LE to TE)
# Designs whose bands under the wing run straight along the undersurface's trailing edge to the tip, as on
# the real sails (photos; the Sport 2 the same): the picker draws them tapering and curling up at the tip.
# From this share of the half span out, every chord takes the bands as drawn there.
STRAIGHT = {"3-panel": 0.12}
# The undersurface in laminate (as on Sport 3s in photos), which the picker does not list for P5:
# the clear and white X-ply laminates it offers for the other panels. Marked "extra" in designs.json.
UNDER_EXTRA = {"P5": [["uvpxb05", "UVPXB05", "#c8c8c8", 0.4], ["uvpxw10-white", "UVPXW10 White", "#ffffff", 1.0]]}
BAND = 4                      # texels: the distance fields hold distances up to this (8 bits across 2 BAND)

# Per glider: the picker model types used, with the viewer's name for each and default colours
# (Wills Wing fabric names). The first design is the default.
GLIDERS = {
    "sport3": [
        ("3-panel", "77", "3-panel", {"P1": "Blue 7304", "P4": "White 170", "P5": "Blue 7304",
                                      "P6A": "Light Yellow 5076", "P6R": "White 170"}),
        ("woosh", "96", "Woosh", {"P1": "Black 2100", "P3": "White 170", "P4": "Black 2100", "P5": "White 170",
                                  "P6": "Bright Orange 4197", "P6A": "Black 2100", "P6R": "Bright Orange 4197"}),
        ("butterfly", "94", "Monarch", {"P1": "Black 2100", "P3": "White 170", "P4": "Black 2100",
                                                    "P5": "Black 2100", "A": "Bright Orange 4197",
                                                    "B": "Bright Orange 4197", "C": "Bright Orange 4197",
                                                    "D": "Bright Orange 4197", "E": "Bright Orange 4197"}),
    ],
}
ZONE_NAMES = {"P1": "Leading edge", "P3": "Top", "P4": "Trailing edge", "P5": "Undersurface",
              "P6": "Swoosh", "P6A": "Stripe", "P6R": "Centre stripe",
              "A": "Wing A", "B": "Wing B", "C": "Wing C", "D": "Wing D", "E": "Wing E"}


def fetch(path):
    local = os.path.join(CACHE, path.lstrip("/"))
    if not os.path.exists(local):
        os.makedirs(os.path.dirname(local), exist_ok=True)
        req = urllib.request.Request(SITE + path, headers={"User-Agent": "falcon4-viewer-tools"})
        with urllib.request.urlopen(req) as r, open(local, "wb") as f:
            f.write(r.read())
    return local


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def hexof(rgb):
    r, g, b = (int(v) for v in re.findall(r"\d+", rgb)[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def save_gray(a, path):
    h, w = a.shape
    subprocess.run(["magick", "-size", f"{w}x{h}", "-depth", "8", "gray:-", "-strip", path],
                   input=a.astype(np.uint8).tobytes(), check=True)


def save_rgba(a, path):
    h, w, _ = a.shape
    subprocess.run(["magick", "-size", f"{w}x{h}", "-depth", "8", "rgba:-", "-strip", "-define", "png:color-type=6", path],
                   input=a.astype(np.uint8).tobytes(), check=True)


# ------------------------------------------------------------------ SVG outlines as polygons
NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def path_polys(d, step=0.25):
    """The closed polygons of an SVG path (M L H V C S Z, absolute and relative), curves cut into
    pieces about `step` long."""
    polys, cur, start, pos, last_ctrl = [], [], None, np.zeros(2), None
    for cmd, args in re.findall(r"([MLHVCSZmlhvcsz])([^MLHVCSZmlhvcsz]*)", d):
        v = [float(x) for x in NUM.findall(args)]
        rel = cmd.islower()
        c = cmd.upper()
        if c == "Z":
            if cur:
                polys.append(np.array(cur))
            cur, pos, last_ctrl = [], start.copy(), None
            continue
        if c == "M":
            if cur:
                polys.append(np.array(cur))
            pts = np.array(v).reshape(-1, 2)
            for i, p in enumerate(pts):
                pos = pos + p if rel else p.copy()
                if i == 0:
                    start = pos.copy(); cur = [pos.copy()]
                else:
                    cur.append(pos.copy())
            last_ctrl = None
        elif c in "LHV":
            vals = v if c != "L" else np.array(v).reshape(-1, 2)
            for p in vals:
                if c == "H":
                    pos = np.array([pos[0] + p if rel else p, pos[1]])
                elif c == "V":
                    pos = np.array([pos[0], pos[1] + p if rel else p])
                else:
                    pos = pos + p if rel else np.array(p, float)
                cur.append(pos.copy())
            last_ctrl = None
        elif c in "CS":
            n = 6 if c == "C" else 4
            for k in range(0, len(v), n):
                a = np.array(v[k:k + n]).reshape(-1, 2)
                if rel:
                    a = a + pos
                if c == "C":
                    p1, p2, p3 = a
                else:
                    p1 = 2 * pos - last_ctrl if last_ctrl is not None else pos.copy()
                    p2, p3 = a
                length = np.linalg.norm(p1 - pos) + np.linalg.norm(p2 - p1) + np.linalg.norm(p3 - p2)
                m = max(2, int(length / step))
                u = np.linspace(0, 1, m + 1)[1:, None]
                cur.extend((1 - u) ** 3 * pos + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u ** 2 * p2 + u ** 3 * p3)
                pos, last_ctrl = p3, p2
    if cur:
        polys.append(np.array(cur))
    return [p for p in polys if len(p) >= 3]


def zone_polys(svg_path, selectors):
    """Polygons per zone (every path, polygon and rect under the element with the zone's id) and
    the order the zones are painted in: both views are in each file, the one shown painted last."""
    import xml.etree.ElementTree as ET
    root = ET.parse(svg_path).getroot()
    tag = lambda e: e.tag.split("}")[-1]
    order = {e.get("id"): i for i, e in enumerate(root.iter()) if e.get("id")}
    by_id = {e.get("id"): e for e in root.iter() if e.get("id")}
    out = []
    for sel in selectors:
        polys = []
        el = by_id[sel.lstrip("#")]
        if el.get("display") == "none":
            out.append([])
            continue
        for e in el.iter():
            if e.get("display") == "none":
                continue
            t = tag(e)
            if t == "path":
                polys += path_polys(e.get("d"))
            elif t in ("polygon",):
                polys.append(np.array(NUM.findall(e.get("points")), float).reshape(-1, 2))
            elif t == "rect":
                x, y, w, h = (float(e.get(k, 0)) for k in ("x", "y", "width", "height"))
                polys.append(np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]))
        out.append(polys)
    return out, [order[sel.lstrip("#")] for sel in selectors]


def segments(polys):
    """All edges of closed polygons as rows (x0, y0, x1, y1)."""
    return np.concatenate([np.hstack([p, np.roll(p, -1, 0)]) for p in polys]) if polys else np.zeros((0, 4))


def crossings(seg, y):
    """x where the edges cross the horizontal line at y (half-open, so a vertex counts once)."""
    y0, y1 = seg[:, 1], seg[:, 3]
    m = (y0 <= y) != (y1 <= y)
    s = seg[m]
    return s[:, 0] + (y - s[:, 1]) * (s[:, 2] - s[:, 0]) / (s[:, 3] - s[:, 1])


def outline(zones):
    """The sail in the drawing: the centre line, the tip and the leading and trailing edge at
    every x (from the union of the zones, transposed: crossings of vertical lines)."""
    seg = segments([p for polys in zones for p in polys])
    swapped = seg[:, [1, 0, 3, 2]]
    left, right = seg[:, [0, 2]].min(), seg[:, [0, 2]].max()
    centre = (left + right) / 2
    xs = np.linspace(centre, right, 8193)
    le, te = np.empty_like(xs), np.empty_like(xs)
    for i, x in enumerate(xs):
        ys = crossings(swapped, x)
        le[i], te[i] = (ys.min(), ys.max()) if len(ys) else (np.nan, np.nan)
    ok = ~np.isnan(le)
    le, te = np.interp(xs, xs[ok], le[ok]), np.interp(xs, xs[ok], te[ok])
    return centre, right, xs, le, te


# The outline as cloth coordinates see it, the same here and in viewer/lib/designs.js (smoothProfile):
# PROFILE bins over the half span; the trailing edge rides over the scallops between the battens
# (straight between its highest points within ENVELOPE of span, the batten tips, blending to the
# plain edge towards the tip), then both
# edges are smoothed (Gaussian, SMOOTH and SMOOTH_TE of span). Lines straight in the drawing stay straight on the sail.
PROFILE, ENVELOPE, ENVELOPE_LE, SMOOTH, SMOOTH_TE = 512, 0.15, 0.06, 0.015, 0.05
TIP, TIP_BLEND = 0.85, 0.06
TIP_FROM = 0.065                      # share of the span: see tip()
UNDER, CLOSE = 0.85, 6                # bottom maps: share of v for the undersurface (to its trailing edge)
EDGE = 0.10                           # share of v for the leading-edge panel (to its rear edge, where the other cloth starts)


def envelope(a, window, upper):
    """Straight lines through the points that stand out most (relative to a fitted parabola) within
    `window` of span: over the trailing edge's scallops (upper), or through the leading edge's
    foremost points (a mesh has no point at every bin)."""
    x = (np.arange(PROFILE) + 0.5) / PROFILE
    r = a - np.polyval(np.polyfit(x, a, 2), x)
    if not upper:
        r = -r
    half = max(1, int(round(window / 2 * PROFILE)))
    keep = sorted({0, PROFILE - 1} | {i for i in range(PROFILE) if r[i] >= r[max(0, i - half):i + half + 1].max()})
    return np.interp(np.arange(PROFILE), keep, a[keep])


def smooth_profile(le, te):
    s = (np.arange(PROFILE) + 0.5) / PROFILE
    raw_le = le

    def blur(a, sigma):
        r = int(np.ceil(3 * sigma * PROFILE))
        k = np.arange(-r, r + 1)
        g = np.exp(-0.5 * (k / (sigma * PROFILE)) ** 2)
        pad = np.pad(a, len(k) // 2, mode="edge")
        return np.convolve(pad, g / g.sum(), mode="valid")
    env = envelope(te, ENVELOPE, True)
    le = blur(envelope(le, ENVELOPE_LE, False), SMOOTH)
    te = blur(env, SMOOTH_TE)
    # Towards the tip, the edges unsmoothed (the tip is round, and the design wraps round it): the
    # leading edge as it is, the trailing edge still straight between the batten tips.
    f = np.clip((s - TIP) / TIP_BLEND, 0, 1)
    return le * (1 - f) + closing(raw_le, True) * f, te * (1 - f) + env * f


def closing(a, opening=False):
    """Morphological closing (fills dips narrower than CLOSE bins) or opening (cuts peaks), as the viewer."""
    n = len(a)
    f, g = (np.min, np.max) if opening else (np.max, np.min)
    a = np.array([f(a[max(0, i - CLOSE):i + CLOSE + 1]) for i in range(n)])
    return np.array([g(a[max(0, i - CLOSE):i + CLOSE + 1]) for i in range(n)])


def smooth_under(a):
    """The undersurface's trailing edge: smoothed as the leading edge, and plain towards the tip."""
    s = (np.arange(PROFILE) + 0.5) / PROFILE
    a = closing(a)       # as the viewer, where a mesh has no point at the edge in every bin
    r = int(np.ceil(3 * SMOOTH * PROFILE))
    k = np.arange(-r, r + 1)
    g = np.exp(-0.5 * (k / (SMOOTH * PROFILE)) ** 2)
    b = np.convolve(np.pad(a, r, mode="edge"), g / g.sum(), mode="valid")
    f = np.clip((s - TIP) / TIP_BLEND, 0, 1)
    return b * (1 - f) + a * f


def front_edge(inner, frame, under):
    """Where the cloth that is not leading-edge cloth starts, at every x of the frame: the rear edge of
    the leading-edge panel, round the tip too (the crescent on top; underneath, the undersurface's rounded
    end). Past the last of it, the undersurface's edge or the trailing edge: all leading-edge cloth there."""
    centre, right, xs, le, te = frame
    seg = segments([p for polys in inner for p in polys])[:, [1, 0, 3, 2]]
    out = np.empty_like(xs)
    for i, x in enumerate(xs):
        ys = crossings(seg, x)
        out[i] = ys.min() if len(ys) else (te[i] if under is None else under[i])
    return out


def smooth_edge(a):
    """The leading-edge panel's rear edge: smoothed lightly, plain towards the tip (where it turns round it)."""
    s = (np.arange(PROFILE) + 0.5) / PROFILE
    r = int(np.ceil(3 * SMOOTH * PROFILE))
    k = np.arange(-r, r + 1)
    g = np.exp(-0.5 * (k / (SMOOTH * PROFILE)) ** 2)
    b = np.convolve(np.pad(a, r, mode="edge"), g / g.sum(), mode="valid")
    f = np.clip((s - 0.78) / TIP_BLEND, 0, 1)
    return b * (1 - f) + a * f


def profile_bins(frame, under=None, edge=None):
    """The outline per profile bin: leading edge, trailing edge, (bottom) the undersurface's trailing
    edge and the leading-edge panel's rear edge, smoothed as the viewer does (lib/designs.js, planCoords)."""
    centre, right, xs, le, te = frame
    sp = (np.arange(PROFILE) + 0.5) / PROFILE
    xs_s = (xs - centre) / (right - centre)
    ple, pte = smooth_profile(np.interp(sp, xs_s, le), np.interp(sp, xs_s, te))
    pun = None
    if under is not None:
        raw = np.interp(sp, xs_s, under)
        pun = np.clip(smooth_under(raw), ple, pte)
    pe = None
    if edge is not None:
        pe = np.clip(smooth_edge(np.interp(sp, xs_s, edge)), ple, pte if pun is None else pun)
    return ple, pte, pun, pe


def to_texels(polys, frame, under=None, edge=None):
    """Polygons from the drawing to cloth texels: u = share of the half span x NS (negative on
    the left wing), v = share of the chord x NT. The chord is in parts, so that the drawing's panel
    edges land on the model's: leading edge to the leading-edge panel's rear edge (v up to EDGE; `edge`),
    then with `under` (the bottom) on to the undersurface's trailing edge (v up to UNDER), then on to the
    trailing edge."""
    centre, right = frame[0], frame[1]
    sp = (np.arange(PROFILE) + 0.5) / PROFILE
    ple, pte, pun, pe = profile_bins(frame, under, edge)
    out = []
    for p in polys:
        s = (p[:, 0] - centre) / (right - centre)
        y = p[:, 1]
        a, b = np.interp(np.abs(s), sp, ple), np.interp(np.abs(s), sp, pte)   # the left wing folds onto the right
        u = b if pun is None else np.interp(np.abs(s), sp, pun)
        top = 1.0 if pun is None else UNDER                                  # v at u
        if pe is None:
            t = top * (y - a) / np.maximum(u - a, 1e-6)
        else:
            e = np.interp(np.abs(s), sp, pe)
            t = np.where(y <= e, EDGE * (y - a) / np.maximum(e - a, 1e-6),
                         EDGE + (top - EDGE) * (y - e) / np.maximum(u - e, 1e-6))
        if pun is not None:
            t = np.where(y <= u, np.minimum(t, UNDER), UNDER + (1 - UNDER) * (y - u) / np.maximum(b - u, 1e-6))
        out.append(np.stack([s * NS, t * NT], 1))
    return out


def inside_mask(polys):
    """Even-odd fill of the polygons on the texel grid (texel centres)."""
    seg = segments(polys)
    mask = np.zeros((NT, NS), bool)
    xs = np.arange(NS) + 0.5
    for j in range(NT):
        cx = np.sort(crossings(seg, j + 0.5))
        for a, b in zip(cx[0::2], cx[1::2]):
            mask[j, (xs >= a) & (xs < b)] = True
    return mask


def distance(polys, band):
    """Distance from each texel centre to the nearest polygon edge, up to `band` texels."""
    d = np.full((NT, NS), float(band))
    for x0, y0, x1, y1 in segments(polys):
        i0, i1 = int(max(0, np.floor(min(x0, x1) - band))), int(min(NS, np.ceil(max(x0, x1) + band) + 1))
        j0, j1 = int(max(0, np.floor(min(y0, y1) - band))), int(min(NT, np.ceil(max(y0, y1) + band) + 1))
        if i0 >= i1 or j0 >= j1:
            continue
        px, py = np.meshgrid(np.arange(i0, i1) + 0.5, np.arange(j0, j1) + 0.5)
        ex, ey = x1 - x0, y1 - y0
        L = ex * ex + ey * ey
        h = np.clip(((px - x0) * ex + (py - y0) * ey) / L, 0, 1) if L > 0 else 0
        dd = np.hypot(px - x0 - h * ex, py - y0 - h * ey)
        d[j0:j1, i0:i1] = np.minimum(d[j0:j1, i0:i1], dd)
    return d


def without(cloth, k):
    """The leading-edge zone comes from the model's own leading-edge cloth (its seam is where the
    sail really changes cloth), so in the map it takes the zone next to it along the chord."""
    out = cloth.copy()
    for i in range(out.shape[1]):
        col = out[:, i]
        bad = col == k
        if not bad.any():
            continue
        good = np.flatnonzero(~bad & (col > 0) & (col != k))
        if not len(good):
            continue
        idx = np.flatnonzero(bad)
        col[idx] = col[good[np.abs(good[None, :] - idx[:, None]).argmin(1)]]
    return out


def straighten(ids, tex, s0):
    """From s0 out, every chord takes the zones of the chord at s0: bands of constant share of the
    chord, parallel to the edges. Each band gets a rectangle among its polygons, so its edges (distance
    fields, seams) are straight too."""
    c0 = int(round(s0 * NS))
    col = ids[:, c0].copy()
    ids[:, c0:] = col[:, None]
    cut = np.flatnonzero(np.diff(col.astype(int))) + 1
    for j0, j1 in zip(np.r_[0, cut], np.r_[cut, NT]):
        k = int(col[j0])
        if k:
            tex[k - 1].append(np.array([[c0, j0], [NS + BAND, j0], [NS + BAND, j1], [c0, j1]], float))


def tip(ids, k, tex, top=1.0):
    """Past the last of the cloth that is not leading-edge cloth (the crescent's outer end on top, the
    undersurface's rounded end underneath), the drawing has only the leading-edge zone between the panel
    edges. The model's tip is its own cloth, a little longer or shorter: carry each row's zone from inside
    that end out to the tip, as bands of constant share of the chord. Each band gets a rectangle among its
    polygons, so its edges (distance fields, seams) are straight and smooth too.

    On top (top = 1) from TIP_FROM of the span before that end: there the drawing's trailing-edge panel is
    cut off by its slanted tip edge, which the model has elsewhere. On the bottom maps (top = UNDER) from
    just inside the undersurface's end, and the rows past UNDER (the top skin seen from below) keep the zone
    they have further in."""
    r1 = int(top * NT)
    rows = ids[int(EDGE * NT) + 2:r1 - 2]
    empty = ((rows == 0) | (rows == k)).all(0)
    cols = np.flatnonzero(empty & (np.arange(NS) > 0.8 * NS))
    if not len(cols):
        return ids
    c = max(0, cols[0] - (12 if top < 1 else int(TIP_FROM * NS)))
    out = ids.copy()
    col = out[:, c].copy()
    if top < 1:
        # (The undersurface's edge runs into the trailing edge before its end: those rows thin out early.)
        c0 = max(0, c - int(TIP_FROM * NS))
        far = out[r1:, c0]
        far = far[(far > 0) & (far != k)]
        if len(far):
            z = int(np.bincount(far).argmax())
            col[r1:] = z
            out[r1:, c0:c] = z
            tex[z - 1].append(np.array([[c0, r1], [c, r1], [c, NT], [c0, NT]], float))
    out[:, c:] = col[:, None]
    cut = np.flatnonzero(np.diff(col.astype(int))) + 1
    for j0, j1 in zip(np.r_[0, cut], np.r_[cut, NT]):
        z = int(col[j0])
        if z:
            tex[z - 1].append(np.array([[c, j0], [NS + BAND, j0], [NS + BAND, j1], [c, j1]], float))
    return out


def rdp(p, eps):
    """Douglas-Peucker: the polyline with points dropped while it stays within eps."""
    if len(p) < 3:
        return p
    a, b = p[0], p[-1]
    ab = b - a
    n = np.hypot(*ab)
    d = np.abs(ab[0] * (p[:, 1] - a[1]) - ab[1] * (p[:, 0] - a[0])) / n if n > 0 else np.hypot(*(p - a).T)
    i = int(np.argmax(d))
    if d[i] <= eps:
        return np.array([a, b])
    return np.vstack([rdp(p[:i + 1], eps)[:-1], rdp(p[i:], eps)])


def seam_lines(tex, ids, painted, skip=()):
    """The seams between the zones as seen (after paint order and the leading-edge fill): polylines
    in texels on the right wing, each oriented so the zone sewn over the seam (the one painted
    later, whose edge shows) lies to its left (+(-dv, du)). Returns [(zone index, points)]."""
    def at(q):
        u, v = int(np.floor(q[0])), int(np.floor(q[1]))
        return ids[v, u] if 0 <= u < NS and 0 <= v < NT else 0
    covered = np.zeros((NT, NS), bool)
    out = []
    for k in reversed(painted):
        mine = []
        for poly in tex[k]:
            p = np.asarray(poly)
            run, side = [], None
            for a, b in zip(p, np.roll(p, -1, 0)):
                e = b - a
                L = np.hypot(*e)
                ok = L > 0 and a[0] >= 0 and b[0] >= 0
                if ok:
                    m, n = (a + b) / 2, np.array([-e[1], e[0]]) / L
                    zl, zr = at(m + 1.5 * n), at(m - 1.5 * n)
                    v, u = int(m[1]), int(m[0])
                    ok = (zl > 0 and zr > 0 and (zl == k + 1) != (zr == k + 1) and zl not in skip and zr not in skip
                          and not (0 <= u < NS and 0 <= v < NT and covered[v, u]))
                    here = zl == k + 1
                    if ok and side is not None and here != side:
                        ok = False
                if ok:
                    if not run:
                        run, side = [a], here
                    run.append(b)
                elif run:
                    mine.append((run, side))
                    run, side = [], None
            if run:
                mine.append((run, side))
        for run, left in mine:
            q = np.array(run)
            if not left:
                q = q[::-1]
            q = rdp(q, 0.05)
            if len(q) >= 2 and np.hypot(*(q[-1] - q[0])) + sum(np.hypot(*(q[1:] - q[:-1]).T)) > 3:
                out.append((k, q))
            for x0, y0 in np.array(run):
                u, v = int(x0), int(y0)
                covered[max(0, v - 2):v + 3, max(0, u - 2):u + 3] = True
    return out


def main():
    picker = json.load(open(fetch(PICKER)))
    types = {m["mtid"]: m for m in picker["model_types"]}
    for glider, designs in GLIDERS.items():
        os.makedirs(os.path.join(OUT, glider), exist_ok=True)
        meta = []
        for key, mtid, label, defaults in designs:
            m = types[mtid]
            scheme = {k: z for k, z in m["modelTypeScheme"].items() if k != "Raked_Tips"}
            zones = list(scheme)
            selectors = [scheme[z]["id"] for z in zones]
            p1 = zones.index("P1") + 1 if "P1" in zones else None
            sides = {z: [] for z in zones}
            top_hem = False
            for side, url in (("top", m["top"]), ("bottom", m["bottom"])):
                polys, order = zone_polys(fetch(url), selectors)
                painted = sorted(range(len(zones)), key=lambda k: order[k])
                for rnd in range(2):
                    frame = outline([p for p in polys if p])
                    under = None
                    if side == "top" and "P4" in zones:
                        # The trailing-edge panel (P4) starts at the seam where the undersurface is sewn to
                        # the top (WW S3-2017-patches-and-panels: the line across the upper body; the picker
                        # draws both at the same share of the chord): its front edge lands on that seam of
                        # the model. Seen from below, the top skin then shows P4 behind the undersurface.
                        k4 = zones.index("P4")
                        top_hem = bool(polys[k4] and any(p for z, p in zip(zones, polys) if z not in ("P1", "P4")))
                        if top_hem:
                            u = outline([polys[k4]])
                            under = np.where(frame[2] > u[1], frame[4], np.interp(frame[2], u[2], u[3]))
                    if side == "bottom" and "P4" in zones:
                        # The undersurface: every zone but the top's trailing edge (P4) seen past it, and
                        # the leading edge (P1), which wraps round the tip.
                        u = outline([p for z, p in zip(zones, polys) if p and z not in ("P1", "P4")])
                        # Past the undersurface's rounded end: the trailing edge (nothing of it there).
                        under = np.where(frame[2] > u[1], frame[4], np.interp(frame[2], u[2], u[4]))
                    # The rear edge of the leading-edge panel: where the other cloth starts.
                    edge = None
                    if p1:
                        inner = [p for z, p in zip(zones, polys) if p and z != "P1" and not (under is not None and z == "P4")]
                        edge = front_edge(inner, frame, under)
                    tex = [to_texels(p, frame, under, edge) for p in polys]
                    ids = np.zeros((NT, NS), np.uint8)
                    for k in painted:               # later zones cover earlier ones
                        if tex[k]:
                            ids[inside_mask(tex[k])] = k + 1
                    # The other view's zones show only as slivers past this view's outline: drop them,
                    # and take the outline from this view's zones alone.
                    seen = np.bincount(ids.ravel(), minlength=len(zones) + 1)[1:]
                    area = seen / max(1, (ids > 0).sum())
                    # On the top view the undersurface's zones lie under the top's own: what shows of one is
                    # a few slivers of it, though they can add up to more than that 0.1 % (the 3-panel's P5
                    # came through as a strip across the tip).
                    hidden = [side == "top" and bool(tex[k]) and seen[k] < 0.05 * inside_mask(tex[k]).sum()
                              for k in range(len(zones))]
                    polys = [p if area[k] >= 0.001 and not hidden[k] else [] for k, p in enumerate(polys)]
                if side == "bottom" and key in STRAIGHT:
                    straighten(ids, tex, STRAIGHT[key])
                used = [zones[k - 1] for k in sorted(set(np.unique(ids)) - {0})]
                for z in used:
                    sides[z].append(side)
                if p1:
                    # The leading-edge colour is the model's own leading-edge cloth, which also covers the
                    # tip (the crescent on top, the closure underneath: sport3-opus s3/sail.py, _tip_cloth).
                    # The maps carry the other zones on, under it and out to the tip.
                    ids = tip(without(ids, p1), p1, tex, UNDER if under is not None else 1.0)
                ids = without(ids, 0)            # past the drawing's outline: the zone next to it
                save_gray(ids, os.path.join(OUT, glider, f"{key}-{side}.png"))
                # The bottom's edge to the top's trailing edge (P4) is the undersurface's hem, which the
                # viewer takes from the model (as the leading-edge cloth's seams).
                skip = {zones.index("P4") + 1} if under is not None and "P4" in zones else set()
                seams = [{"zone": k + 1, "st": [round(float(c), 5) for q in pts for c in (q[0] / NS, q[1] / NT)]}
                         for k, pts in seam_lines(tex, ids, painted, skip) if k + 1 != p1]
                with open(os.path.join(OUT, glider, f"{key}-{side}-seams.json"), "w") as f:
                    json.dump(seams, f, separators=(",", ":"))
                n_tex = (len(zones) + 3) // 4
                sdf = np.zeros((NT, NS, 4 * n_tex), np.uint8)
                for k in range(len(zones)):
                    shown = ids == k + 1
                    if k + 1 == p1 or not shown.any():
                        continue
                    # The zone's visible edge: its own outline where nothing covers it, and the
                    # outlines of the zones painted over it.
                    above = [q for j in painted[painted.index(k):] for q in tex[j]]
                    d = distance(above, BAND)
                    sdf[..., k] = np.rint(np.clip(0.5 + np.where(shown, d, -d) / (2 * BAND), 0, 1) * 255)
                for i in range(n_tex):
                    save_rgba(sdf[..., 4 * i:4 * i + 4], os.path.join(OUT, glider, f"{key}-{side}-sdf{i}.png"))
                print(f"{glider} {key} {side}: zones {used}")
            fabrics = {}
            for z in zones:
                fabrics[z] = [[slug(c["name"]), c["name"], hexof(c["color"]), float(c.get("opacity") or 1)]
                              for c in scheme[z]["colors"] if str(c.get("show_in_palette", 1)) == "1"]
                have = {f[0] for f in fabrics[z]}
                fabrics[z] += [f + ["extra"] for f in UNDER_EXTRA.get(z, []) if f[0] not in have]
                names = [f[1] for f in fabrics[z]]
                if defaults.get(z) not in names:
                    sys.exit(f"{glider} {key}: default {defaults.get(z)!r} for {z} is not one of {names}")
            meta.append({"id": key, "label": label, "picker": f"{m['name']} (model type {mtid})",
                         **({"straight": True} if key in STRAIGHT else {}), **({"topHem": True} if top_hem else {}),
                         "zones": [{"id": z, "name": f"{z} · {ZONE_NAMES.get(z, z)}",
                                    "default": slug(defaults[z]), "sides": sides[z], "fabrics": fabrics[z]} for z in zones]})
        with open(os.path.join(OUT, glider, "designs.json"), "w") as f:
            json.dump({"source": SITE + "/inventory/ colour picker, " + PICKER,
                       "map": {"size": [NS, NT], "s": "half span, keel to tip", "t": "chord, LE to TE",
                               "edge": EDGE, "band": BAND, "sdf": "zone k: texture (k-1)//4, channel (k-1)%4; 0.5 the edge"},
                       "designs": meta}, f, indent=1)
        print("wrote", os.path.join(OUT, glider))


if __name__ == "__main__":
    main()
