import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Substitute the import boundary; verify no download, caching and retry behavior.
const source=fs.readFileSync(new URL('../public/drive-launch.js',import.meta.url),'utf8').replace(/import\('\.\/drive-experience\.js(?:\?[^']*)?'\)/,'loadExperienceModule()');
let handler,imports=0,fail=true;const opened=[],status={textContent:'',setAttribute(){}};
const context=vm.createContext({console:{warn(){}},document:{getElementById:id=>id==='drive-launch-status'?status:null,addEventListener:(type,fn)=>{assert.equal(type,'click');handler=fn;}},loadExperienceModule:async()=>{imports++;if(fail)throw Error('Module HTTP 503');return{initDrivingExperience:async()=>({open:async mode=>{opened.push(mode);return true;}})};}});
vm.runInContext(source,context);assert.equal(imports,0);
const button={dataset:{openDrive:'drift'},attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};
const event={target:{closest:selector=>selector==='[data-open-drive]'?button:null},preventDefault(){}};
await handler(event);assert.equal(imports,1);assert.match(status.textContent,/ещё раз/);assert.equal(button.attributes['aria-busy'],undefined);
fail=false;await handler(event);assert.equal(imports,2);assert.deepEqual(opened,['drift']);assert.equal(status.textContent,'');
button.dataset.openDrive='race';await handler(event);assert.equal(imports,2,'Successful module/API reused');assert.deepEqual(opened,['drift','race']);
await handler({target:{closest:()=>null}});assert.equal(imports,2);
console.log(JSON.stringify({passed:true,beforeClickImports:0,moduleFailureRetry:true,delegatedModes:opened,singleApi:true}));
