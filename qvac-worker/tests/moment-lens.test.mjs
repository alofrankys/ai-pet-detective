import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  MOMENT_LENS_MODEL,
  MOMENT_LENS_MODELS,
  MOMENT_LENS_PROMPTS,
  MOMENT_LENS_SAMPLING,
  analyseMomentLens,
  analyseMomentLensPair,
  buildMomentLensRequest,
  sanitizeMomentLensAnswer
} from '../studio.mjs'
import {
  VISIONPSY_MODELS,
  VISIONPSY_WEIGHT_QUANTIZATION,
  inspectVisionPsyRuntime
} from '../visionpsy-runtimes.mjs'
import {
  clampPhotoIndex,
  createObjectUrlLease,
  createPhotoSelection,
  filterSupportedPhotoFiles,
  isSupportedPhotoFile,
  movePhotoIndex,
  photoCounter,
  selectPhotoIndex
} from '../public/photo-selection.js'

const here=path.dirname(fileURLToPath(import.meta.url))
const workerRoot=path.resolve(here,'..')
const repositoryRoot=path.resolve(workerRoot,'..')
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9])
const expectedPrompts={
  describe:`What is visible in this image? Give a detailed natural-language description of the main subject, setting, posture, visible objects, colors, contact, and spatial relationships, including only details that can be seen directly. If the image is too unclear to describe reliably, answer UNCLEAR.`,
  objects:`What objects are visible in this image, and how do they relate to the main subject and to one another? Give a detailed natural-language description of their visible attributes, positions, and contact. Include only details that can be seen directly. If no reliable object relationship is visible, answer UNCLEAR.`,
  spatial:`How are the visible people, animals, objects, furniture, and surroundings arranged in this image? Give a detailed natural-language description of relative positions, distance, overlap, and contact, including only details that can be seen directly. If the spatial arrangement is too unclear to describe reliably, answer UNCLEAR.`
}

const photo=(name,type,size=12)=>({name,type,size})

test('photo selection accepts only non-empty JPEG, PNG and WebP files',()=>{
  const fixtures=[
    [photo('dog.jpg','image/jpeg'),true],
    [photo('dog.jpeg','image/jpg'),true],
    [photo('dog.png','image/png'),true],
    [photo('dog.webp','image/webp'),true],
    [photo('DOG.JPEG',''),true],
    [photo('dog.WEBP','application/octet-stream'),true],
    [photo('fake.jpg','text/plain'),false],
    [photo('dog.gif','image/gif'),false],
    [photo('empty.png','image/png',0),false],
    [null,false]
  ]
  for(const [file,expected] of fixtures)assert.equal(isSupportedPhotoFile(file),expected,file?.name)
  assert.deepEqual(filterSupportedPhotoFiles(fixtures.map(([file])=>file)),fixtures.filter(([,supported])=>supported).map(([file])=>file))
})

test('photo queue preserves picker order and normalizes labels and types lazily',()=>{
  const first=photo('first.JPG','')
  const ignored=photo('notes.txt','text/plain')
  const second=photo('second.png','image/png')
  const third=photo('third.webp','application/octet-stream')
  const selection=createPhotoSelection([first,ignored,second,third])

  assert.deepEqual(selection.items.map(item=>item.file),[first,second,third])
  assert.deepEqual(selection.items.map(({name,type,size})=>({name,type,size})),[
    {name:'first.JPG',type:'image/jpeg',size:12},
    {name:'second.png',type:'image/png',size:12},
    {name:'third.webp',type:'image/webp',size:12}
  ])
  assert.equal(selection.index,0)
  assert.equal(photoCounter(selection),'1 / 3')
  assert.equal('url' in selection.items[0],false)
})

test('photo queue navigation is clamped and exposes an honest counter',()=>{
  const selection=createPhotoSelection([
    photo('one.jpg','image/jpeg'),
    photo('two.jpg','image/jpeg'),
    photo('three.jpg','image/jpeg')
  ])
  assert.equal(clampPhotoIndex(-8,3),0)
  assert.equal(clampPhotoIndex(99,3),2)
  assert.equal(clampPhotoIndex(Infinity,3),2)
  assert.equal(selectPhotoIndex(selection,1.9),1)
  assert.equal(photoCounter(selection),'2 / 3')
  assert.equal(movePhotoIndex(selection,10),2)
  assert.equal(photoCounter(selection),'3 / 3')
  assert.equal(movePhotoIndex(selection,-20),0)
  assert.equal(photoCounter(selection),'1 / 3')

  const empty=createPhotoSelection([])
  assert.equal(selectPhotoIndex(empty,5),0)
  assert.equal(movePhotoIndex(empty,-1),0)
  assert.equal(photoCounter(empty),'0 / 0')
})

test('photo object URLs are created lazily, reused and revoked exactly once',()=>{
  const created=[]
  const revoked=[]
  const lease=createObjectUrlLease({
    createObjectURL(file){const url=`blob:test-${created.length+1}`;created.push({file,url});return url},
    revokeObjectURL(url){revoked.push(url)}
  })
  const first=photo('one.jpg','image/jpeg')
  const second=photo('two.png','image/png')

  assert.deepEqual(created,[])
  assert.equal(lease.replace(first),'blob:test-1')
  assert.equal(lease.replace(first),'blob:test-1')
  assert.equal(created.length,1)
  assert.deepEqual(revoked,[])
  assert.equal(lease.replace(second),'blob:test-2')
  assert.deepEqual(revoked,['blob:test-1'])
  lease.clear()
  lease.clear()
  assert.deepEqual(revoked,['blob:test-1','blob:test-2'])
})

test('photo selection stays DOM-free and never starts analysis',()=>{
  const source=fs.readFileSync(path.join(workerRoot,'public/photo-selection.js'),'utf8')
  assert.doesNotMatch(source,/\bdocument\b|querySelector|addEventListener|\bfetch\s*\(|\/api\/moment-lens/)
})

test('Moment Lens uses the three exact single-image prompts',()=>{
  assert.deepEqual(MOMENT_LENS_PROMPTS,expectedPrompts)
  assert.equal(MOMENT_LENS_MODEL,'VisionPsy-Nano-460M-Flash')
})

test('comparison registry pins the exact official Flash and Full Q4 weight files',()=>{
  assert.equal(VISIONPSY_WEIGHT_QUANTIZATION,'Q4_K_M-imat')
  assert.deepEqual(VISIONPSY_MODELS.map(model=>({
    variant:model.variant,
    displayName:model.displayName,
    alias:model.alias,
    modelFile:model.modelFile,
    projectorFile:model.projectorFile,
    modelUrl:model.modelUrl,
    projectorUrl:model.projectorUrl,
    expectedModelBytes:model.expectedModelBytes,
    expectedProjectorBytes:model.expectedProjectorBytes,
    expectedModelSha256:model.expectedModelSha256,
    expectedProjectorSha256:model.expectedProjectorSha256
  })),[
    {
      variant:'flash',
      displayName:'VisionPsy-Nano-460M-Flash',
      alias:'visionpsy-flash-q4',
      modelFile:'visionpsy-nano-460m-flash-q4_k_m-imat.gguf',
      projectorFile:'mmproj-visionpsy-nano-460m-flash-q8.gguf',
      modelUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/visionpsy-nano-460m-flash-q4_k_m-imat.gguf',
      projectorUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-flash-q8.gguf',
      expectedModelBytes:303_143_488,
      expectedProjectorBytes:108_782_144,
      expectedModelSha256:'90b0abe16180f1fe5918bc5d89c3b6eeaf40520a50f906d6303a59a32b699fbc',
      expectedProjectorSha256:'bbb0691873a4e638f6928898b3c3be9a4730bd4ced301197726a4fcb549695d0'
    },
    {
      variant:'quality',
      displayName:'VisionPsy-Nano-460M',
      alias:'visionpsy-quality-q4',
      modelFile:'visionpsy-nano-460m-q4_k_m-imat.gguf',
      projectorFile:'mmproj-visionpsy-nano-460m-q8.gguf',
      modelUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/visionpsy-nano-460m-q4_k_m-imat.gguf',
      projectorUrl:'https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-q8.gguf',
      expectedModelBytes:303_143_488,
      expectedProjectorBytes:108_782_144,
      expectedModelSha256:'41794b9f501e30f44f19c8be4b87b965db77fbd3e4c7625291999cff7966db8a',
      expectedProjectorSha256:'92f1bb80acaba3e7b59b6534f47447b830330bc9051018d6d8b5d768e58503c2'
    }
  ])
  assert.equal(new Set(VISIONPSY_MODELS.map(model=>model.port)).size,2)
  for(const model of VISIONPSY_MODELS){
    assert.match(model.modelFile,/q4_k_m-imat\.gguf$/)
    assert.doesNotMatch(model.modelFile,/q5|q8/i)
    // Tether ships a variant-specific Q8 multimodal projector alongside each Q4 model.
    assert.match(model.projectorFile,/q8\.gguf$/)
  }
  assert.deepEqual(MOMENT_LENS_MODELS.map(model=>({
    variant:model.variant,
    model:model.model,
    quantization:model.quantization,
    model_file:model.model_file,
    projector_file:model.projector_file
  })),VISIONPSY_MODELS.map(model=>({
    variant:model.variant,
    model:model.displayName,
    quantization:'Q4_K_M-imat',
    model_file:model.modelFile,
    projector_file:model.projectorFile
  })))
})

test('Moment Lens prompts contain no schema, JSON or action vocabulary',()=>{
  const forbidden=/[{}\[\]`|]|actor_ref|target_ref|"events"|petting|lying_down|jumping_off|tail_wagging|mouth_contact|playing|running|rolling/i
  for(const prompt of Object.values(MOMENT_LENS_PROMPTS))assert.doesNotMatch(prompt,forbidden)
})

test('one frozen frame produces exactly one image and one VisionPsy call',async()=>{
  const calls=[]
  const result=await analyseMomentLens({jpeg,preset:'describe'},async(messages,maxTokens,context)=>{
    calls.push({messages,maxTokens,context})
    return 'A dog is beside a green chair.'
  },(()=>{const values=[10,34.6];return()=>values.shift()})())
  assert.equal(calls.length,1)
  assert.equal(calls[0].messages.length,1)
  assert.equal(calls[0].messages.flatMap(message=>message.content).filter(item=>item.type==='image_url').length,1)
  assert.equal(calls[0].messages.flatMap(message=>message.content).filter(item=>item.type==='text').length,1)
  assert.equal(calls[0].maxTokens,256)
  assert.deepEqual(calls[0].context,{visual_mode:'single_image',image_count:1,preserve_raw:true})
  assert.equal(result.inference_ms,24.6)
  assert.equal(result.answer,'A dog is beside a green chair.')
  assert.equal(result.version,1)
  assert.equal(result.mode,'moment_lens')
  assert.equal(result.preset,'describe')
})

test('the comparison sends one identical single-image request to each model',async()=>{
  const calls=[]
  const modelCall=variant=>async(body,context,spec)=>{
    calls.push({variant,body,context,spec})
    return variant==='flash'?'A dog is beside a green chair.':'A dog is next to a green chair.'
  }
  const result=await analyseMomentLensPair(
    {jpeg,preset:'describe'},
    {flash:modelCall('flash'),quality:modelCall('quality')},
    (()=>{const values=[0,10,35,40,100,110];return()=>values.shift()})()
  )

  assert.equal(calls.length,2)
  assert.deepEqual(calls.map(call=>call.variant),['flash','quality'])
  assert.strictEqual(calls[0].body,calls[1].body)
  assert.strictEqual(calls[0].context,calls[1].context)
  assert.deepEqual(calls.map(call=>call.spec.variant),['flash','quality'])
  for(const call of calls){
    const content=call.body.messages.flatMap(message=>message.content)
    const images=content.filter(item=>item.type==='image_url')
    const texts=content.filter(item=>item.type==='text')
    assert.equal(images.length,1)
    assert.equal(texts.length,1)
    assert.equal(images[0].image_url.url,`data:image/jpeg;base64,${jpeg.toString('base64')}`)
    assert.equal(texts[0].text,MOMENT_LENS_PROMPTS.describe)
    assert.equal(call.body.model,'visionpsy')
    assert.equal(call.body.max_tokens,MOMENT_LENS_SAMPLING.max_tokens)
    assert.equal(call.body.temperature,MOMENT_LENS_SAMPLING.temperature)
    assert.equal('top_p' in call.body,false)
    assert.deepEqual(call.context,{visual_mode:'single_image',image_count:1,preserve_raw:true})
  }
  assert.equal(result.results[0].inference_ms,30)
  assert.equal(result.results[1].inference_ms,65)
  assert.equal(result.total_ms,110)
})

test('the data-driven decode is shared greedy 256 with no stochastic sampling fields',()=>{
  assert.deepEqual(MOMENT_LENS_SAMPLING,{max_tokens:256,temperature:0})
  const request=buildMomentLensRequest({jpeg,preset:'describe'})
  assert.equal(request.api_body.max_tokens,256)
  assert.equal(request.api_body.temperature,0)
  assert.equal('top_p' in request.api_body,false)
  assert.equal('top_k' in request.api_body,false)
})

test('output token count prefers standard usage and falls back to llama timings',async()=>{
  const withUsage=await analyseMomentLens({jpeg,preset:'describe'},async()=>({
    content:'A dog stands beside a chair.',
    usage:{completion_tokens:7,prompt_tokens:44,total_tokens:51},
    timings:{predicted_n:6}
  }),()=>0)
  assert.equal(withUsage.output_tokens,7)
  assert.equal(withUsage.usage.completion_tokens,7)
  assert.equal(withUsage.timings.predicted_n,6)

  const withTimings=await analyseMomentLens({jpeg,preset:'describe'},async()=>({
    content:'A dog stands beside a chair.',
    usage:{prompt_tokens:44},
    timings:{predicted_n:5}
  }),()=>0)
  assert.equal(withTimings.output_tokens,5)

  const invalid=await analyseMomentLens({jpeg,preset:'describe'},async()=>({
    content:'A dog stands beside a chair.',
    usage:{completion_tokens:'7'},
    timings:{predicted_n:-1}
  }),()=>0)
  assert.equal(invalid.output_tokens,null)
})

test('the model finish reason is preserved so the UI can disclose a 256-token stop',async()=>{
  const result=await analyseMomentLens({jpeg,preset:'describe'},async()=>({
    content:'A detailed response that stops at the configured boundary',
    finish_reason:'length',
    usage:{completion_tokens:256}
  }),()=>0)
  assert.equal(result.finish_reason,'length')
  assert.equal(result.output_tokens,256)
  assert.equal(result.status,'clear')
})

test('output token counts remain independent for both model cards and honest unclear results',async()=>{
  const result=await analyseMomentLensPair({jpeg,preset:'describe'}, {
    flash:async()=>({content:'A dog stands beside a chair.',usage:{completion_tokens:6}}),
    quality:async()=>({content:'UNCLEAR',usage:{completion_tokens:1}})
  },()=>0)
  assert.equal(result.results[0].output_tokens,6)
  assert.equal(result.results[0].status,'clear')
  assert.equal(result.results[1].output_tokens,1)
  assert.equal(result.results[1].status,'unclear')
})

test('Flash and Full start simultaneously and complete independently',async()=>{
  const trace=[]
  let releaseFlash
  let releaseQuality
  const flashGate=new Promise(resolve=>{releaseFlash=resolve})
  const qualityGate=new Promise(resolve=>{releaseQuality=resolve})
  const comparison=analyseMomentLensPair({jpeg,preset:'objects'}, {
    flash:async()=>{trace.push('flash:start');await flashGate;trace.push('flash:end');return 'A dog is beside a red ball.'},
    quality:async()=>{trace.push('quality:start');await qualityGate;trace.push('quality:end');return 'A dog is next to a red ball.'}
  },()=>0)

  assert.deepEqual(trace,['flash:start','quality:start'])
  releaseQuality()
  await Promise.resolve()
  assert.deepEqual(trace,['flash:start','quality:start','quality:end'])
  releaseFlash()
  await comparison
  assert.deepEqual(trace,['flash:start','quality:start','quality:end','flash:end'])
})

test('sanitation, raw output and timing remain independent per model',async()=>{
  const flashRaw='```json\n{"events":[{"action":"playing"}]}\n```'
  const qualityRaw='A dog is under a wooden table. A person is behind it.'
  const result=await analyseMomentLensPair(
    {jpeg,preset:'spatial'},
    {flash:async()=>flashRaw,quality:async()=>qualityRaw},
    (()=>{const values=[5,10,20,30,70,75];return()=>values.shift()})()
  )
  const [flash,quality]=result.results
  assert.equal(flash.status,'unclear')
  assert.equal(flash.answer,null)
  assert.equal(flash.raw_answer,flashRaw)
  assert.equal(flash.inference_ms,20)
  assert.equal(quality.status,'clear')
  assert.equal(quality.answer,'A dog is under a wooden table. A person is behind it.')
  assert.equal(quality.raw_answer,qualityRaw)
  assert.equal(quality.inference_ms,50)
  assert.equal(result.total_ms,70)
})

test('one model failure cannot block or contaminate the other model',async()=>{
  const calls={flash:0,quality:0}
  const updates=[]
  const result=await analyseMomentLensPair({jpeg,preset:'describe'}, {
    flash:async()=>{calls.flash++;throw new Error('Flash unavailable: private diagnostics')},
    quality:async()=>{calls.quality++;return 'A dog is on a grey rug.'}
  },()=>0,event=>updates.push(event))
  const [flash,quality]=result.results

  assert.deepEqual(calls,{flash:1,quality:1})
  assert.equal(flash.status,'error')
  assert.equal(flash.answer,null)
  assert.equal(flash.raw_answer,'')
  assert.equal(flash.reason,'model_error')
  assert.equal(quality.status,'clear')
  assert.equal(quality.answer,'A dog is on a grey rug.')
  assert.deepEqual(updates.map(update=>`${update.type}:${update.variant||update.result?.variant}`),[
    'model-start:flash','model-start:quality','model-result:flash','model-result:quality'
  ])
})

test('the comparison never retries either model or makes a repair call',async()=>{
  const calls={flash:0,quality:0}
  const result=await analyseMomentLensPair({jpeg,preset:'objects'}, {
    flash:async()=>{calls.flash++;throw new Error('offline')},
    quality:async()=>{calls.quality++;throw new Error('offline')}
  },()=>0)
  assert.deepEqual(calls,{flash:1,quality:1})
  assert.deepEqual(result.results.map(item=>item.status),['error','error'])
})

test('Moment Lens never retries or makes a repair call',async()=>{
  let calls=0
  await assert.rejects(()=>analyseMomentLens({jpeg,preset:'objects'},async()=>{calls++;throw new Error('model unavailable')},()=>0),/model unavailable/)
  assert.equal(calls,1)
})

test('UNCLEAR remains an honest unclear result',async()=>{
  const result=await analyseMomentLens({jpeg,preset:'spatial'},async()=>`  UNCLEAR.\n`)
  assert.equal(result.status,'unclear')
  assert.equal(result.answer,null)
  assert.equal(result.raw_answer,`  UNCLEAR.\n`)
  assert.equal(result.reason,'model_unclear')
})

test('a response reporting no relevant visible subject remains raw model output',()=>{
  const raw='The image shows a green background with no visible dog, person, or object.'
  const result=sanitizeMomentLensAnswer(raw)
  assert.equal(result.status,'clear')
  assert.equal(result.answer,raw)
  assert.equal(result.raw_answer,raw)
  assert.equal(result.reason,null)
})

test('a prose response about blur is shown without a local semantic decision',()=>{
  const raw='The image is blurry and cannot be described.'
  const result=sanitizeMomentLensAnswer(raw)
  assert.equal(result.status,'clear')
  assert.equal(result.answer,raw)
  assert.equal(result.raw_answer,raw)
  assert.equal(result.reason,null)
})

test('schema, JSON and prompt echoes never become visible',()=>{
  const fixtures=[
    'In the video, [ { "events": [ { "actor_ref": "subject_1", "action": "petting|lying_down|standing_up|sitting_down|jumping_off|jumping_on|playing"',
    '```json\n{"events":[{"action":"playing"}]}\n```',
    'events: A dog is beside a chair.',
    'actor_ref: dog; action: beside chair.',
    'model_output: A dog is beside a chair.',
    'events = actor_ref = subject_1, action = petting.',
    'actor_ref = dog; action = beside chair.',
    'Output - A dog is beside a chair.',
    'Describe the clearest visible fact involving the dog, a person, or an object in this image.',
    'Use one short factual sentence. Describe only what is directly visible.',
    'What is visible in this image? Give a detailed natural-language description of the main subject, setting, posture, visible objects, colors, contact, and spatial relationships.'
  ]
  for(const fixture of fixtures){const result=sanitizeMomentLensAnswer(fixture);assert.equal(result.status,'unclear',fixture);assert.equal(result.answer,null,fixture)}
})

test('the complete natural-language answer is preserved and shown without local truncation',async()=>{
  const raw='A dog is under a wooden table. A person is visible behind it.\n\nA red bowl rests near the dog.\n'
  const result=await analyseMomentLens({jpeg,preset:'spatial'},async()=>raw)
  assert.equal(result.raw_answer,raw)
  assert.equal(result.answer,'A dog is under a wooden table. A person is visible behind it.\n\nA red bowl rests near the dog.')
  assert.equal(result.status,'clear')
})

test('natural prose longer than the former 45-word UI limit remains complete',()=>{
  const raw='A brown dog stands on a pale rug beside a low wooden table. A blue bowl sits near its front paws, while a person in dark trousers stands behind the table. Sunlight enters from a window on the left and falls across the floor, the rug, and the side of the dog.'
  assert.ok(raw.split(/\s+/).length>45)
  const result=sanitizeMomentLensAnswer(raw)
  assert.equal(result.status,'clear')
  assert.equal(result.answer,raw)
})

test('natural-language model claims are preserved rather than semantically rewritten locally',()=>{
  for(const claim of [
    'The happy dog is beside a red ball.',
    'The dog wants to pick up the red ball.',
    'The dog has just moved away from the chair.'
  ]){
    const result=sanitizeMomentLensAnswer(claim)
    assert.equal(result.status,'clear')
    assert.equal(result.answer,claim)
    assert.equal(result.raw_answer,claim)
  }
})

test('request builder accepts only a fixed preset and one JPEG payload',()=>{
  const request=buildMomentLensRequest({jpeg,preset:'objects'})
  assert.equal(request.prompt,MOMENT_LENS_PROMPTS.objects)
  assert.match(request.messages[0].content[0].image_url.url,/^data:image\/jpeg;base64,/)
  assert.throws(()=>buildMomentLensRequest({jpeg,preset:'custom'}),/Unknown Moment Lens preset/)
  assert.throws(()=>buildMomentLensRequest({preset:'describe'}),/requires one JPEG image/)
})

test('runtime identity inspection rejects a healthy server with the wrong model weights',async()=>{
  const spec=VISIONPSY_MODELS[0]
  const fetchImpl=async url=>({
    ok:true,
    async json(){
      if(String(url).endsWith('/v1/models'))return {data:[{id:spec.alias}]}
      if(String(url).endsWith('/props'))return {
        model_path:'/models/visionpsy-nano-460m-flash-q5_k_m-imat.gguf',
        model_alias:spec.alias,
        modalities:{vision:true}
      }
      return {}
    }
  })
  const state=await inspectVisionPsyRuntime(spec,{fetchImpl})
  assert.equal(state.ready,false)
  assert.equal(state.reason,'wrong_model')
  assert.equal(state.loadedFile,'visionpsy-nano-460m-flash-q5_k_m-imat.gguf')
})

test('runtime identity inspection accepts only each model exact Q4 file and alias',async()=>{
  for(const spec of VISIONPSY_MODELS){
    const fetchImpl=async url=>({
      ok:true,
      async json(){
        if(String(url).endsWith('/v1/models'))return {data:[{id:spec.alias}]}
        if(String(url).endsWith('/props'))return {
          model_path:`/models/${spec.modelFile}`,
          model_alias:spec.alias,
          modalities:{vision:true}
        }
        return {}
      }
    })
    const state=await inspectVisionPsyRuntime(spec,{fetchImpl})
    assert.equal(state.ready,true,spec.variant)
    assert.equal(state.reason,null,spec.variant)
    assert.equal(state.loadedFile,spec.modelFile,spec.variant)
  }
})

test('runtime identity inspection rejects exact weights without the VisionPsy projector',async()=>{
  const spec=VISIONPSY_MODELS[0]
  const fetchImpl=async url=>({
    ok:true,
    async json(){
      if(String(url).endsWith('/v1/models'))return {data:[{id:spec.alias}]}
      if(String(url).endsWith('/props'))return {
        model_path:`/models/${spec.modelFile}`,
        model_alias:spec.alias,
        modalities:{vision:false}
      }
      return {}
    }
  })
  const state=await inspectVisionPsyRuntime(spec,{fetchImpl})
  assert.equal(state.ready,false)
  assert.equal(state.reason,'wrong_model')
  assert.equal(state.vision,false)
})

test('Studio exposes only the Moment Lens analysis route',()=>{
  const server=fs.readFileSync(path.join(workerRoot,'studio.mjs'),'utf8')
  assert.match(server,/\/api\/moment-lens/)
  assert.match(server,/photo-selection\.js/)
  assert.doesNotMatch(server,/\/api\/(?:detect|pose|interpret|session-summary|finalize-session|deep|youtube)/)
  assert.doesNotMatch(server,/contact[_ -]?sheet|detectorHealth|startDetector|NarrativeEngine|analyseDeepWindow/i)
})

test('browser controller makes one streamed comparison request and contains no temporal pipeline',()=>{
  const app=fs.readFileSync(path.join(workerRoot,'public/app.js'),'utf8')
  assert.equal((app.match(/fetch\('\/api\/moment-lens'/g)||[]).length,1)
  assert.match(app,/currentSource\?\.kind==='photo'/)
  assert.match(app,/freezeContext\.drawImage\(source,/)
  assert.match(app,/createPhotoSelection\(files\)/)
  assert.match(app,/getReader\(\)/)
  assert.match(app,/model-start/)
  assert.match(app,/model-result/)
  assert.match(app,/finish_reason==='length'/)
  assert.match(app,/elements\.answer\.textContent=/)
  assert.doesNotMatch(app,/elements\.answer\.innerHTML=/)
  assert.doesNotMatch(app,/\/api\/moment-lens\/(?:flash|quality)/)
  assert.doesNotMatch(app,/contact[_ -]?sheet|semanticFrames|tracking|detector|narrative|deepAnalysis|youtube/i)
})

test('complete model answers can wrap without a CSS line clamp',()=>{
  const css=fs.readFileSync(path.join(workerRoot,'public/styles.css'),'utf8')
  assert.match(css,/\.model-answer\s*\{[^}]*white-space:pre-wrap/s)
  assert.doesNotMatch(css,/(?:line-clamp|-webkit-line-clamp)/i)
})

test('public interface exposes two polished result cards and no Live or Deep modes',()=>{
  const html=fs.readFileSync(path.join(workerRoot,'public/index.html'),'utf8')
  assert.match(html,/<h1>Moment Lens<\/h1>/)
  for(const id of ['flashCard','qualityCard','flashAnswer','qualityAnswer','flashOutputTokens','qualityOutputTokens'])assert.match(html,new RegExp(`id=["']${id}["']`),id)
  assert.match(html,/Flash/)
  assert.match(html,/Full/)
  assert.match(html,/Compare this moment/)
  assert.match(html,/Same selected image/)
  assert.equal((html.match(/Greedy · max 256/g)||[]).length,2)
  assert.doesNotMatch(html,/Live Studio|Deep Analysis|YouTube URL|data-studio-mode|sessionModal/)
})

test('public interface accepts one or many local photos without a multi-image API',()=>{
  const html=fs.readFileSync(path.join(workerRoot,'public/index.html'),'utf8')
  const app=fs.readFileSync(path.join(workerRoot,'public/app.js'),'utf8')
  assert.match(html,/id="photoButton"/)
  assert.match(html,/id="photoFiles"[^>]+type="file"[^>]+accept="image\/jpeg,image\/png,image\/webp"[^>]+multiple/)
  for(const id of ['photoPreview','photoQueue','photoFilmstrip','previousPhoto','nextPhoto','photoCounter'])assert.match(html,new RegExp(`id=["']${id}["']`),id)
  assert.equal((app.match(/fetch\('\/api\/moment-lens'/g)||[]).length,1)
  assert.doesNotMatch(app,/Promise\.all\([^)]*photo|for\s*\([^)]*photo[^)]*\)\s*\{[^}]*fetch\('/s)
  assert.doesNotMatch(app,/\/api\/moment-lens\/(?:batch|photos|image)/)
  assert.match(app,/analyseButton\.disabled=busy\|\|sourceLoading\|\|!sourceReady/)
  assert.match(app,/if\(busy\|\|sourceLoading\|\|!modelsReady/)
  assert.match(app,/const thumbnailObjectUrls=new Set\(\)/)
  assert.match(app,/clearThumbnailObjectUrls\(\)/)
  assert.doesNotMatch(app,/if\(currentSource\)showSource\(/)
})

test('Moment Lens has no runtime package dependencies',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(workerRoot,'package.json'),'utf8'))
  const lock=JSON.parse(fs.readFileSync(path.join(workerRoot,'package-lock.json'),'utf8'))
  assert.deepEqual(manifest.dependencies,undefined)
  assert.deepEqual(manifest.devDependencies,undefined)
  assert.deepEqual(lock.packages[''].dependencies,undefined)
  assert.deepEqual(Object.keys(lock.packages),[''])
})

test('legacy detector, Narrative and Deep modules are absent',()=>{
  const removed=[
    'pet_detective/pipeline.py',
    'pet_detective/narrative_v2.py',
    'pyproject.toml',
    'qvac-worker/detector.mjs',
    'qvac-worker/public/narrative-engine-v2.js',
    'qvac-worker/public/deep-video-v3.js',
    'qvac-worker/tests/narrative-engine-v2.test.mjs',
    'qvac-worker/tests/deep-video-v3.test.mjs',
    'qvac-worker/tests/regression-video-001.benchmark.mjs'
  ]
  for(const relative of removed)assert.equal(fs.existsSync(path.join(repositoryRoot,relative)),false,relative)
})
