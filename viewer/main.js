import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const $ = (s) => document.querySelector(s);
const categories = {'01':'Sail & cloth','02':'Main frame','03':'Battens & washout','04':'Lower wires','05':'Upper wires & bridles','06':'Hardware','07':'Webbing'};
const groups = Object.fromEntries(Object.keys(categories).map(k=>[k,[]]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer, model, selected, transition;
const scene=new THREE.Scene(); scene.background=new THREE.Color('#222c38');
const camera=new THREE.PerspectiveCamera(38,1,.005,200);
const host=$('#canvas-host');
try { renderer=new THREE.WebGLRenderer({antialias:true}); }
catch(error){ $('#load-title').textContent='3D viewing is unavailable';$('#load-detail').textContent='Enable WebGL in your browser, then reload this page.';$('#progress').hidden=true; }
if(renderer) start();
function start(){
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 host.append(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D hang glider. Drag to orbit, scroll to zoom. Press F to fit.');
 const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.7;room.dispose();pmrem.dispose();
 scene.add(new THREE.HemisphereLight(0xffffff,0x919781,.6));const sun=new THREE.DirectionalLight(0xfff8eb,1.6);sun.position.set(3,8,5);scene.add(sun);
 const fill=new THREE.DirectionalLight(0xe0f0ff,.5);fill.position.set(-3,-3,-5);scene.add(fill);
 const grid=new THREE.GridHelper(24,48,0x46525f,0x303c49);grid.position.y=-.12;scene.add(grid);
 let renderPending=false;
 function requestRender(){if(!renderPending){renderPending=true;requestAnimationFrame(renderFrame);}}
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.12;controls.minDistance=.055;controls.maxDistance=40;controls.autoRotateSpeed=.5;
 const center=new THREE.Vector3(0,1.5,-1.7);
 const vec=a=>new THREE.Vector3(...a);
 function view(target,offset,label){
  transition={from:camera.position.clone(),to:vec(target).add(vec(offset)),targetFrom:controls.target.clone(),targetTo:vec(target),start:performance.now()};
  if(reduced){camera.position.copy(transition.to);controls.target.copy(transition.targetTo);transition=null;}
  $('#view-label').textContent=label;controls.autoRotate=false;$('#rotate').checked=false;requestRender();
 }
 function fit(name='perspective'){
  const distance=5/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))/Math.min(camera.aspect,1.55);
  const directions={perspective:[.35,.48,1],front:[0,.04,1],top:[0,1,.001],underside:[.35,-.6,1]};
  view(center.toArray(),vec(directions[name]).normalize().multiplyScalar(distance).toArray(),name[0].toUpperCase()+name.slice(1));
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));
 }
 function visibility(values){
  for(const [key,objects] of Object.entries(groups)){const enabled=values.includes(key);objects.forEach(o=>o.visible=enabled);$(`#layer-${key}`).checked=enabled;}
  select(null);count();
 }
 function partCount(objects){return new Set(objects.map(o=>o.userData.displayName)).size;}
 function count(){ $('#part-count').textContent=`${partCount(Object.values(groups).flat().filter(o=>o.visible))} / ${partCount(Object.values(groups).flat())} PARTS`; }
 function select(object){
  if(selected){selected.material=selected.userData.originalMaterial;selected=null;}
  if(object){selected=object;object.material=object.userData.highlightMaterial;}
  $('#selection').textContent=object?object.userData.displayName:'Click a part to identify it · Double-click to focus';

 }
 for(const [key,label] of Object.entries(categories)){
  const row=document.createElement('label');row.className='toggle';row.innerHTML=`<span>${label}<small id="count-${key}"></small></span><input type="checkbox" id="layer-${key}" checked>`;$('#layers').append(row);
  row.querySelector('input').addEventListener('change',e=>{groups[key].forEach(o=>o.visible=e.target.checked);select(null);count();});
 }
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{fit(b.dataset.view);$('#detail').value='';}));
 const details={nose:[[0,1.68,-.08],[.25,-.19,.43]],junction:[[2.66,1.68,-1.65],[.45,-.4,.5]],basebar:[[.64,.23,-1.48],[.23,.16,.35]],tension:[[0,1.7,-2.7],[.25,.2,.35]]};
 $('#detail').addEventListener('change',e=>{if(!details[e.target.value])return;visibility(['02','03','04','05','06','07']);const [t,o]=details[e.target.value];view(t,o,e.target.selectedOptions[0].textContent);document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));});
 $('#grid').onchange=e=>grid.visible=e.target.checked;
 $('#wireframe').onchange=e=>Object.values(groups).flat().forEach(o=>{o.userData.originalMaterial.wireframe=e.target.checked;o.userData.highlightMaterial.wireframe=e.target.checked;});
 $('#rotate').onchange=e=>{transition=null;controls.autoRotate=e.target.checked;};
 $('#fit').onclick=()=>fit();
 $('#reset').onclick=()=>{visibility(Object.keys(categories));$('#wireframe').checked=false;$('#wireframe').dispatchEvent(new Event('change'));$('#grid').checked=true;grid.visible=true;$('#detail').value='';fit();};
 $('#capture').onclick=()=>{renderer.render(scene,camera);renderer.domElement.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='falcon4-view.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});};
 controls.addEventListener('start',()=>transition=null);
 const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();let down;
 renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
 function pick(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(Object.values(groups).flat().filter(o=>o.visible),false)[0]?.object;}
 renderer.domElement.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<4)select(pick(e));});
 renderer.domElement.addEventListener('dblclick',e=>{const o=pick(e);if(!o)return;select(o);const box=new THREE.Box3().setFromObject(o);const c=box.getCenter(new THREE.Vector3());const r=Math.max(box.getSize(new THREE.Vector3()).length(),.18);view(c.toArray(),camera.position.clone().sub(controls.target).normalize().multiplyScalar(r*1.8).toArray(),'Part detail');});
 renderer.domElement.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'){e.preventDefault();fit();}if(e.key==='Escape')select(null);});
 document.addEventListener('input',requestRender);document.addEventListener('click',requestRender);controls.addEventListener('change',requestRender);
 const resize=()=>{const {width,height}=host.getBoundingClientRect();camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);requestRender();};new ResizeObserver(resize).observe(host);resize();
 let previous=performance.now();function renderFrame(now){renderPending=false;const dt=Math.min((now-previous)/1000,.1);previous=now;if(transition){const t=Math.min((now-transition.start)/650,1);const eased=t*t*(3-2*t);camera.position.lerpVectors(transition.from,transition.to,eased);controls.target.lerpVectors(transition.targetFrom,transition.targetTo,eased);if(t===1)transition=null;}controls.update(dt);renderer.render(scene,camera);if(transition||controls.autoRotate)requestRender();}
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();$('#loading').hidden=false;$('#load-title').textContent='Graphics connection interrupted';$('#load-detail').textContent='Reload the page to restore the model.';$('#progress').hidden=true;$('#retry').hidden=false;$('#retry').onclick=()=>location.reload();});
 async function load(){
  $('#loading').hidden=false;$('#retry').hidden=true;$('#progress').hidden=false;$('#progress').value=0;$('#load-title').textContent='Loading model…';
  try{
   const response=await fetch('./parts.json');if(!response.ok)throw new Error('Parts index is unavailable.');const parts=await response.json();
   const mapping=Object.fromEntries(Object.entries(parts).map(([name,group])=>[THREE.PropertyBinding.sanitizeNodeName(name),{name,group}]));
   const gltf=await new GLTFLoader().loadAsync('./model.glb',e=>{const percent=e.total?Math.round(e.loaded/e.total*100):0;$('#progress').value=percent;$('#load-detail').textContent=percent===100?'Preparing materials…':`${(e.loaded/1048576).toFixed(1)} MB downloaded`;});
   model=gltf.scene;
   model.traverse(o=>{if(!o.isMesh)return;let node=o;while(node&&!mapping[node.name])node=node.parent;const part=node&&mapping[node.name];if(!part)throw new Error(`Missing part category: ${o.name}`);o.userData.displayName=part.name;o.userData.category=part.group;o.material=o.material.clone();o.userData.originalMaterial=o.material;o.userData.highlightMaterial=o.material.clone();o.userData.highlightMaterial.emissive.set('#bc7a28');o.userData.highlightMaterial.emissiveIntensity=.35;groups[part.group].push(o);});
   scene.add(model);for(const key of Object.keys(groups))$(`#count-${key}`).textContent=partCount(groups[key]);
   document.body.dataset.modelReady='true';$('#model-controls').disabled=false;$('#fit').disabled=false;$('#capture').disabled=false;$('#loading').hidden=true;count();fit();
  }catch(error){for(const objects of Object.values(groups))objects.length=0;console.error(error);$('#load-title').textContent='The model could not load';$('#load-detail').textContent='Check the connection and try again. '+error.message;$('#progress').hidden=true;$('#retry').hidden=false;}
 }
 $('#retry').onclick=load;load();
}
