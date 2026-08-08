import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {evaluateRegressionV001} from '../public/deep-video-v3.js'

const here=path.dirname(fileURLToPath(import.meta.url)),fixture=JSON.parse(fs.readFileSync(path.resolve(here,'../../tests/fixtures/regression-video-001.expected.json'),'utf8')),debugPath=process.argv[2]
if(!debugPath||!fs.existsSync(debugPath)){console.log(JSON.stringify({benchmark:'Regression Video #001',measured:false,status:'V3 debug JSON required',video:fixture.video,command:'npm run benchmark:regression -- /absolute/path/to/v3-debug.json'},null,2));process.exit(0)}
const debug=JSON.parse(fs.readFileSync(debugPath,'utf8')),events=debug.semantic_events_final||[],metrics=evaluateRegressionV001(events,fixture,debug.summary_input||[]),vision=debug.vision_metrics||{},ratio=vision.useful_vision_responses?vision.structured_events_created/vision.useful_vision_responses:null
console.log(JSON.stringify({benchmark:'Regression Video #001',measured:true,debug:debugPath,...metrics,structured_conversion_ratio:ratio,structured_conversion_pass:ratio==null?null:ratio>=.70},null,2))
process.exit(metrics.pass&&(ratio==null||ratio>=.70)?0:1)
