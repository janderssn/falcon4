// Writes viewer/public/models/opus/parts.json: maps every mesh in the opus GLB
// to one of the viewer's seven visibility groups by its part name.
// Usage: node tools/make_opus_parts.cjs
const fs = require('fs');
const path = require('path');
const glb = path.join(__dirname, '..', 'viewer', 'public', 'models', 'opus', 'model.glb');
const buf = fs.readFileSync(glb);
const gltf = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
const rules = [
  ['07', /webbing|hang loop|cinch strap|rope loop|bungee/i],                    // Webbing
  ['01', /^Sail (top|P\d|number)|Trailing edge hem|Keel pocket|Kingpost patch|Kingpost base sock|Nosecone/i], // Sail & cloth
  ['03', /batten|Lever tip|String tip|Washout/i],                              // Battens & washout
  ['06', /\btang\b|keyhole/i],                                                 // wire tangs count as hardware
  ['05', /^Top .*wire|Bridle|Sweep wire/i],                                    // Upper wires & bridles
  ['04', /^Bottom .*wire/i],                                                   // Lower wires
  ['06', /bolt|nut\b|washer|rivet|screw|pin\b|ring\b|bracket|cap\b|lug|plug|spacer|lock|grip|stud|ball|hub|flange|spigot|elbow|label|slot|collar|Noseplate|saddle|tab\b/i], // Hardware
  ['02', /Keel|^LE |Crossbar|Kingpost|Downtube|Basetube|Control bar/i],        // Main frame
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
console.log('parts', Object.keys(parts).length, counts, unmatched.length ? 'fallback to hardware: ' + unmatched.join(', ') : '');
