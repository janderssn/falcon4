// Writes viewer/public/models/<id>/parts.json: maps every mesh in that build's GLB
// to one of the viewer's seven visibility groups by its part name.
// Usage: node tools/make_parts.cjs [opus|sport3|tecma]   (default opus; not for astra,
// whose parts.json comes from its own repo)
const fs = require('fs');
const path = require('path');
const id = process.argv[2] || 'opus';
const glb = path.join(__dirname, '..', 'viewer', 'public', 'models', id, 'model.glb');
const buf = fs.readFileSync(glb);
const gltf = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
const rules = [
  ['07', /webbing|hang loop|cinch strap|rope (hand )?loop|bungee|suspension tape|backup eye|Rapidlink|(?<!pocket )strap\b/i],     // Webbing
  ['01', /^Sail (top|upper|lower|under|P\d|number|panel)|^Sail\b(?! mount)|Trailing (edge )?hem|pocket|zigzag|stitch|Kingpost patch|Kingpost base sock|Nosecone|cloth cover|Nose bridge|Nose former|Nose lacing reinforcement|Mast binding|Batten pocket top tape|Batten doubler|Batten end reinforcement|Hinge cover (hook|loop) strip|Leading-edge|hem\b|selvedge|seam\b|patch\b|emblem|lap\b|Undersail|Tip cuff/i], // Sail & cloth
  ['05', /^Bridle|Luff (bridle|line)/i],                                       // reflex bridles, before the batten rule (#4)
  ['03', /batten|Lever tip|String tip|Washout|Sprog|Tip wand|^Wand /i],               // Battens & washout
  ['06', /\btang\b|keyhole/i],                                                 // wire tangs count as hardware
  ['05', /^Top .*wire|Bridle|Sweep wire/i],                                    // Upper wires & bridles
  ['04', /^Bottom .*wire/i],                                                   // Lower wires
  ['06', /bolt|nut\b|washer|rivet|screw|pin\b|ring\b|bracket|cap\b|lug|plug|spacer|lock|grip|stud|ball|hub|flange|spigot|elbow|label|slot|collar|Noseplate|saddle|tab\b|bush|fitting|shackle|insert|channel|block|sheave|bearing|cord|rope|line\b|tie\b|swage|thimble|eyelet|grommet|sticker|lashing|keeper|clip|pad\b/i], // Hardware
  ['02', /Keel|^LE |Crossbar|Kingpost|Downtube|Basetube|Basebar|Control bar|Upright|Link\b/i], // Main frame
];
const parts = {};
const unmatched = [];
for (const n of gltf.nodes) {
  if (n.mesh === undefined) continue;
  const hit = rules.find(([, re]) => re.test(n.name));
  if (!hit) unmatched.push(n.name);
  parts[n.name] = hit ? hit[0] : '06';
}
fs.writeFileSync(path.join(path.dirname(glb), 'parts.json'), JSON.stringify(parts));
const counts = {};
Object.values(parts).forEach(g => counts[g] = (counts[g] || 0) + 1);
console.log(id, 'parts', Object.keys(parts).length, counts, unmatched.length ? 'fallback to hardware: ' + unmatched.join(', ') : '');
