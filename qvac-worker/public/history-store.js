const DATABASE_NAME='visionpsy-moment-lens-history'
const DATABASE_VERSION=1
const STORE_NAME='runs'

function requestResult(request){
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error||new Error('History database request failed'))
  })
}

function transactionDone(transaction){
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve()
    transaction.onabort=()=>reject(transaction.error||new Error('History transaction aborted'))
    transaction.onerror=()=>reject(transaction.error||new Error('History transaction failed'))
  })
}

function openDatabase(indexedDb){
  if(!indexedDb?.open)return Promise.reject(new Error('Persistent browser history is unavailable'))
  const request=indexedDb.open(DATABASE_NAME,DATABASE_VERSION)
  request.onupgradeneeded=()=>{
    const database=request.result
    const store=database.objectStoreNames.contains(STORE_NAME)?request.transaction.objectStore(STORE_NAME):database.createObjectStore(STORE_NAME,{keyPath:'id'})
    if(!store.indexNames.contains('updated_at'))store.createIndex('updated_at','updated_at')
  }
  return requestResult(request)
}

function cleanIdentifier(value){
  return String(value||'').trim().replace(/[^a-zA-Z0-9._:-]+/g,'-').slice(0,240)
}

function derivedIdentifier(report){
  const date=cleanIdentifier(report?.created_at||report?.started_at||report?.completed_at||'imported')
  const first=cleanIdentifier(report?.items?.[0]?.filename||'run')
  return `run:${date}:${Number(report?.items?.length)||0}:${first}`
}

export function normalizeHistoryReport(value,{now=()=>new Date().toISOString()}={}){
  if(!value||typeof value!=='object'||!Array.isArray(value.items)||!value.items.length)throw new Error('History run must contain analysed items')
  const report=JSON.parse(JSON.stringify(value))
  const id=cleanIdentifier(report.history_id)||derivedIdentifier(report)
  const timestamp=String(report.completed_at||report.started_at||report.created_at||now())
  return {
    id,
    created_at:String(report.created_at||timestamp),
    updated_at:String(now()),
    completed_at:report.completed_at?String(report.completed_at):null,
    photo_count:report.items.length,
    preset:String(report.preset||'describe'),
    report:{...report,history_id:id}
  }
}

export async function saveHistoryReport(value,{indexedDb=globalThis.indexedDB,now}={}){
  const record=normalizeHistoryReport(value,{now:now||(()=>new Date().toISOString())})
  const database=await openDatabase(indexedDb)
  try{
    const transaction=database.transaction(STORE_NAME,'readwrite')
    transaction.objectStore(STORE_NAME).put(record)
    await transactionDone(transaction)
    return record
  }finally{database.close()}
}

export async function listHistoryReports({indexedDb=globalThis.indexedDB}={}){
  const database=await openDatabase(indexedDb)
  try{
    const transaction=database.transaction(STORE_NAME,'readonly')
    const records=await requestResult(transaction.objectStore(STORE_NAME).getAll())
    await transactionDone(transaction)
    return records.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))
  }finally{database.close()}
}
