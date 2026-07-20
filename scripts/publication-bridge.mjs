import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ADAPTER_ID = "matrix-publication-bridge/html-runtime-explorer";
const ADAPTER_VERSION = "1.0.0";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function explorerHtml(publication) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Explore the certified Matrix Knowledge Compiler runtime for ${escapeHtml(publication.id)}.">
  <title>Runtime Explorer — ${escapeHtml(publication.title)}</title>
  <link rel="stylesheet" href="explorer.css">
</head>
<body>
  <a class="skip-link" href="#workspace">Skip to runtime</a>
  <header class="masthead">
    <nav><a href="../../">← Publication</a><a href="../../../">All publications</a></nav>
    <p class="eyebrow">Publication Bridge · HTML adapter</p>
    <h1>${escapeHtml(publication.title)}</h1>
    <p class="lede">A derived, read-only view of the compiler runtime. Authority remains in the unchanged artifacts linked throughout this explorer.</p>
    <div class="identity"><span>${escapeHtml(publication.id)}</span><code>${escapeHtml(publication.buildId)}</code></div>
  </header>
  <main id="workspace" class="workspace">
    <aside aria-label="Runtime views">
      <h2>Runtime</h2>
      <nav id="views" class="views"></nav>
      <div class="authority-note"><strong>Authority boundary</strong><p>This interface is derived. Follow any “Raw artifact” link for the unchanged compiler product.</p></div>
    </aside>
    <section class="content" aria-live="polite">
      <div id="status" class="status">Loading certified runtime…</div>
      <div id="view"></div>
    </section>
  </main>
  <noscript><p class="noscript">JavaScript is required for the interactive explorer. The unchanged runtime remains available from <a href="../../manifest.json">manifest.json</a> and <a href="../../catalog.json">catalog.json</a>.</p></noscript>
  <script type="module" src="explorer.js"></script>
</body>
</html>
`;
}

const EXPLORER_CSS = `
:root{color-scheme:dark;--bg:#08100f;--panel:#101b19;--panel2:#142421;--ink:#edf7f2;--muted:#9eb9ae;--line:#29433b;--mint:#62e6b1;--gold:#e7bf67;--red:#ff8c82;font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.5}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -20%,#18473b 0,transparent 34rem),var(--bg);color:var(--ink)}a{color:var(--mint)}code,pre{font-family:"SFMono-Regular",Consolas,monospace}.skip-link{position:absolute;left:-999px}.skip-link:focus{left:1rem;top:1rem;background:#fff;color:#000;padding:.6rem;z-index:10}.masthead{padding:2rem clamp(1.2rem,5vw,5rem) 2.5rem;border-bottom:1px solid var(--line)}.masthead nav{display:flex;gap:1.3rem}.eyebrow{margin:3rem 0 .5rem;color:var(--mint);font-size:.78rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.masthead h1{max-width:70rem;margin:.2rem 0;font-size:clamp(2.2rem,5vw,5.5rem);line-height:.98;letter-spacing:-.045em}.lede{max-width:52rem;color:var(--muted);font-size:1.08rem}.identity{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-top:1.3rem}.identity span{background:var(--mint);color:#052019;border-radius:99px;padding:.25rem .7rem;font-weight:800}.identity code{color:var(--muted);overflow-wrap:anywhere}.workspace{display:grid;grid-template-columns:minmax(15rem,20rem) 1fr;min-height:70vh}.workspace aside{padding:2rem;border-right:1px solid var(--line);background:#0c1614}.workspace aside h2{font-size:.8rem;letter-spacing:.15em;text-transform:uppercase;color:var(--muted)}.views{display:grid;gap:.25rem}.views button{border:0;border-radius:.45rem;padding:.7rem .8rem;text-align:left;background:transparent;color:var(--ink);cursor:pointer;font:inherit}.views button:hover,.views button[aria-current=true]{background:var(--panel2);color:var(--mint)}.authority-note{margin-top:2rem;padding:1rem;border:1px solid var(--line);border-radius:.6rem;color:var(--muted);font-size:.86rem}.authority-note strong{color:var(--gold)}.authority-note p{margin:.4rem 0 0}.content{min-width:0;padding:clamp(1.2rem,4vw,4rem)}.status{color:var(--muted)}.status.error{color:var(--red)}.view-header{display:flex;justify-content:space-between;gap:1rem;align-items:start;margin-bottom:2rem}.view-header h2{margin:0;font-size:clamp(1.8rem,4vw,3.2rem);letter-spacing:-.035em}.raw-link{white-space:nowrap}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:1rem}.card,.record{background:var(--panel);border:1px solid var(--line);border-radius:.7rem;padding:1rem}.metric{font-size:2rem;font-weight:800;color:var(--mint)}.label{color:var(--muted);font-size:.82rem;text-transform:uppercase;letter-spacing:.08em}.records{display:grid;gap:.7rem}.record h3{margin:.1rem 0 .4rem}.record p{margin:.25rem 0;color:var(--muted)}.record code,.code-wrap{overflow-wrap:anywhere}.toolbar{display:flex;gap:.7rem;flex-wrap:wrap;margin:0 0 1rem}.toolbar input,.toolbar select{min-width:min(100%,20rem);padding:.7rem .8rem;border:1px solid var(--line);border-radius:.45rem;background:var(--panel);color:var(--ink);font:inherit}.badge{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:.12rem .5rem;color:var(--muted);font-size:.78rem}.valid{color:var(--mint)}.invalid{color:var(--red)}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:.65rem;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em}pre{max-height:65vh;overflow:auto;background:#050b0a;border:1px solid var(--line);border-radius:.7rem;padding:1rem;font-size:.82rem}.pagination{display:flex;gap:.8rem;align-items:center;margin-top:1rem}.pagination button{padding:.45rem .8rem}.noscript{margin:2rem;padding:1rem;border:1px solid var(--red)}
@media(max-width:760px){.workspace{grid-template-columns:1fr}.workspace aside{border-right:0;border-bottom:1px solid var(--line)}.views{grid-template-columns:repeat(2,minmax(0,1fr))}.view-header{display:block}.raw-link{display:inline-block;margin-top:.5rem}table{display:block;overflow:auto}}
`;

const EXPLORER_JS = `
const ROOT="../../";
const artifacts={manifest:"manifest.json",catalog:"catalog.json",graph:"graph.json",lexical:"lexical-index.json",chunks:"chunks.jsonl",corpus:"corpus.jsonl",validation:"validation.json",certification:"merged-document-certification.json"};
const state={data:{},view:"overview",page:0};
const definitions=[
  ["overview","Overview"],["manifest","Manifest"],["catalog","Catalog"],["graph","Graph"],["lexical","Lexical index"],["chunks","Chunks"],["corpus","Corpus"],["blobs","Blobs"],["validation","Validation"],["certification","Certification"],["merged","Merged documents"]
];
const el=(tag,attrs={},children=[])=>{const node=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v===null||v===false)continue;if(k==="class")node.className=v;else if(k.startsWith("on"))node.addEventListener(k.slice(2),v);else node.setAttribute(k,v===true?"":v)};for(const child of[].concat(children))node.append(child instanceof Node?child:document.createTextNode(String(child)));return node};
const raw=(path,label="Raw artifact")=>el("a",{href:ROOT+path,class:"raw-link"},label);
const header=(title,path,description)=>el("div",{class:"view-header"},[el("div",{},[el("h2",{},title),el("p",{},description)]),path?raw(path):""]);
const jsonPre=value=>el("pre",{},JSON.stringify(value,null,2));
const parseLines=text=>text.split(/\\r?\\n/).filter(Boolean).map(line=>JSON.parse(line));
async function fetchArtifact(name,optional=false){try{const response=await fetch(ROOT+artifacts[name]);if(!response.ok)throw new Error(String(response.status));const text=await response.text();return name==="chunks"||name==="corpus"?parseLines(text):JSON.parse(text)}catch(error){if(optional)return null;throw new Error("Unable to read "+artifacts[name]+" ("+error.message+")")}}
async function load(){const names=["manifest","catalog","graph","lexical","chunks","corpus","validation","certification"];const values=await Promise.all(names.map(name=>fetchArtifact(name,name==="certification")));names.forEach((name,index)=>state.data[name]=values[index]);document.getElementById("status").remove();renderNav();navigate(location.hash.slice(1)||"overview")}
function renderNav(){const nav=document.getElementById("views");nav.replaceChildren(...definitions.map(([id,label])=>el("button",{type:"button","data-view":id,onclick:()=>navigate(id)},label)))}
function navigate(view){if(!definitions.some(([id])=>id===view))view="overview";state.view=view;state.page=0;history.replaceState(null,"","#"+view);document.querySelectorAll("[data-view]").forEach(button=>button.setAttribute("aria-current",String(button.dataset.view===view)));render()}
function metric(value,label){return el("div",{class:"card"},[el("div",{class:"metric"},value??"—"),el("div",{class:"label"},label)])}
function overview(){const m=state.data.manifest,g=state.data.graph,l=state.data.lexical,v=state.data.validation;const blobs=m.documents?.length??0;return [header("Runtime overview",null,"Publication statistics derived from the unchanged runtime artifacts."),el("div",{class:"cards"},[metric(m.source_count??m.documents?.length,"Sources"),metric(m.chunk_count??state.data.chunks.length,"Chunks"),metric(m.edge_count??g.edges?.length,"Edges"),metric(Object.keys(l.terms||{}).length,"Lexical terms"),metric(blobs,"Blobs"),metric(m.merged_document_count??m.primary_outputs?.length??0,"Merged documents")]),el("div",{class:"record"},[el("h3",{},"Integrity"),el("p",{class:v.valid?"valid":"invalid"},v.valid?"VALID — compiler validation passed":"INVALID — inspect validation report"),el("p",{},"Build "),el("code",{class:"code-wrap"},m.build_id),el("p",{},[raw("manifest.json","Open manifest")," · ",raw("catalog.json","Start with catalog")])]) ]}
function generic(name,title,description){return[header(title,artifacts[name],description),jsonPre(state.data[name]) ]}
function catalog(){const entries=state.data.catalog.entries||[];const wrap=el("div");const input=el("input",{type:"search",placeholder:"Filter sources by title or path","aria-label":"Filter catalog"});const list=el("div",{class:"records"});const draw=()=>{const q=input.value.toLocaleLowerCase();const found=entries.filter(x=>(x.title+" "+x.path).toLocaleLowerCase().includes(q));list.replaceChildren(...found.map(item=>el("article",{class:"record"},[el("h3",{},item.title||item.path),el("p",{},item.path),el("span",{class:"badge"},item.media_type||"artifact"),el("p",{},[el("code",{},item.source_id)," · ",String(item.chunk_ids?.length||0)," chunks"]),el("p",{},raw("blobs/sha256/"+item.sha256.slice(0,2)+"/"+item.sha256,"Raw source blob"))])))};input.addEventListener("input",draw);draw();wrap.append(header("Catalog",artifacts.catalog,"The compiler's navigation and source-to-chunk routing layer."),el("div",{class:"toolbar"},input),list);return[wrap]}
function pagedRecords(title,path,description,records,renderRecord){const size=25;const pages=Math.max(1,Math.ceil(records.length/size));state.page=Math.min(state.page,pages-1);const list=el("div",{class:"records"},records.slice(state.page*size,(state.page+1)*size).map(renderRecord));const pager=el("div",{class:"pagination"},[el("button",{type:"button",disabled:state.page===0?"":null,onclick:()=>{state.page--;render()}},"Previous"),el("span",{},"Page "+(state.page+1)+" of "+pages),el("button",{type:"button",disabled:state.page>=pages-1?"":null,onclick:()=>{state.page++;render()}},"Next")]);return[header(title,path,description),list,pager]}
function chunks(){const records=state.data.chunks;return pagedRecords("Chunk explorer",artifacts.chunks,"Bounded contexts with stable source and line identities.",records,item=>el("article",{class:"record"},[el("h3",{},item.heading_path?.join(" › ")||"Untitled context"),el("p",{},[el("code",{},item.chunk_id)," · lines "+item.start_line+"–"+item.end_line]),el("p",{},item.text),el("details",{},[el("summary",{},"Traceability"),jsonPre({source_id:item.source_id,ordinal:item.ordinal,text_sha256:item.text_sha256})])]))}
function corpus(){return pagedRecords("Corpus stream",artifacts.corpus,"Streamable source metadata for ingestion pipelines.",state.data.corpus,item=>el("article",{class:"record"},[el("h3",{},item.title||item.path),el("p",{},item.path),el("code",{},item.sha256)]))}
function graph(){const g=state.data.graph;const wrap=el("div");const select=el("select",{"aria-label":"Graph record type"},[el("option",{value:"edges"},"Edges"),el("option",{value:"nodes"},"Nodes")]);const output=el("div");const draw=()=>{const records=g[select.value]||[];output.replaceChildren(el("p",{},records.length+" "+select.value),jsonPre(records.slice(0,250)),records.length>250?el("p",{},"Showing first 250 records. Use the raw artifact for the complete graph."):"")};select.addEventListener("change",draw);draw();wrap.append(header("Graph",artifacts.graph,"Artifact, chunk, containment, link, and identity relationships."),el("div",{class:"toolbar"},select),output);return[wrap]}
function lexical(){const terms=state.data.lexical.terms||{};const wrap=el("div");const input=el("input",{type:"search",placeholder:"Enter an exact normalized term","aria-label":"Search lexical index"});const output=el("div",{class:"record"});const draw=()=>{const term=input.value.toLocaleLowerCase().trim();const postings=terms[term];output.replaceChildren(term?el("h3",{},term):el("h3",{},"Search the index"),postings?jsonPre(postings):el("p",{},term?"No exact posting.":Object.keys(terms).length+" indexed terms."))};input.addEventListener("input",draw);draw();wrap.append(header("Lexical index",artifacts.lexical,"Deterministic token-to-chunk positional postings."),el("div",{class:"toolbar"},input),output);return[wrap]}
function blobs(){const docs=state.data.manifest.documents||[];return[header("Blob explorer",null,"Byte-exact, content-addressed source artifacts derived from manifest hashes."),el("div",{class:"records"},docs.map(item=>{const p="blobs/sha256/"+item.sha256.slice(0,2)+"/"+item.sha256;return el("article",{class:"record"},[el("h3",{},item.title||item.path),el("p",{},item.path),el("code",{class:"code-wrap"},item.sha256),el("p",{},[String(item.size)+" bytes · ",raw(p,"Open authoritative blob")])])}))]}
function merged(){
  const outputs=state.data.manifest.primary_outputs||[];
  return[
    header("Merged documents",null,"Mandatory certified primary outputs."),
    el("div",{class:"records"},outputs.map(item=>el("article",{class:"record"},[
      el("h3",{},item.id),
      el("code",{class:"code-wrap"},item.sha256),
      el("p",{},raw(item.path,"Open certified merged document"))
    ])))
  ]
}
function render(){const view=document.getElementById("view");const renderers={overview,manifest:()=>generic("manifest","Manifest","Build identity, source inventory, provenance, hashes, and primary outputs."),catalog,graph,lexical,chunks,corpus,blobs,validation:()=>generic("validation","Validation","Machine-readable compiler integrity attestation."),certification:()=>state.data.certification?generic("certification","Certification","Merged-document identity and complete ordered source lineage."):[header("Certification",null,"This publication schema does not provide a separate certification artifact."),el("p",{},"Inspect the manifest and validation record for its declared contract.")],merged};view.replaceChildren(...renderers[state.view]())}
load().catch(error=>{const status=document.getElementById("status");status.className="status error";status.textContent=error.message});
`;

export async function adaptHtmlPublication({ publication, destinationDirectory }) {
  const adapterRoot = path.join(destinationDirectory, "_bridge", "html");
  await mkdir(adapterRoot, { recursive: true });
  const products = [
    ["index.html", explorerHtml(publication)],
    ["explorer.css", EXPLORER_CSS],
    ["explorer.js", EXPLORER_JS],
  ];
  for (const [relativePath, content] of products) {
    await writeFile(path.join(adapterRoot, relativePath), content, "utf8");
  }
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    entryPath: "_bridge/html/",
    products: products.map(([relativePath]) => `_bridge/html/${relativePath}`),
  };
}
