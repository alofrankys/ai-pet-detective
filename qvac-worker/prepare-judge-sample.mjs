import fs from 'node:fs'
import path from 'node:path'

const [reportArg,blindArg,keyArg,sourceArg]=process.argv.slice(2)
if(!reportArg||!blindArg||!keyArg){
  console.error('Usage: node prepare-judge-sample.mjs <report.json> <blind.json> <key.json> [image-directory]')
  process.exit(2)
}

const reportFile=path.resolve(reportArg)
const blindFile=path.resolve(blindArg)
const keyFile=path.resolve(keyArg)
const report=JSON.parse(fs.readFileSync(reportFile,'utf8'))
const sourceDir=path.resolve(sourceArg||report.source_directory||'')
const cases=[]
const key=[]

function resolveImagePath(filename){
  const candidates=[
    path.join(sourceDir,`${filename}.png`),
    path.join(sourceDir,filename),
    path.join(sourceDir,`${path.parse(filename).name}.jpg`)
  ]
  const resolved=candidates.find(candidate=>fs.existsSync(candidate))
  if(!resolved)throw new Error(`Missing image for ${filename}`)
  return resolved
}

for(const [index,item] of report.items.entries()){
  const byVariant=Object.fromEntries(item.results.map(result=>[result.variant,result]))
  if(!byVariant.flash||!byVariant.quality)throw new Error(`Missing paired result for ${item.filename}`)
  const aVariant=index%2===0?'flash':'quality'
  const bVariant=aVariant==='flash'?'quality':'flash'
  cases.push({
    case_id:`case_${String(index+1).padStart(2,'0')}`,
    filename:item.filename,
    image_path:resolveImagePath(item.filename),
    response_a:byVariant[aVariant].answer||byVariant[aVariant].raw_answer,
    response_b:byVariant[bVariant].answer||byVariant[bVariant].raw_answer
  })
  key.push({case_id:cases.at(-1).case_id,a:aVariant,b:bVariant})
}

for(const [file,value] of [[blindFile,{version:1,sample_size:cases.length,cases}],[keyFile,{version:1,key}]]){
  fs.mkdirSync(path.dirname(file),{recursive:true})
  fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`)
}

console.log(`Prepared ${cases.length} blinded cases`)
