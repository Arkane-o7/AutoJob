const ESCAPE = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" });

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ESCAPE[character]);
}

export const ATS_CASES = Object.freeze([
  { id: "workday", host: "copart.wd12.myworkdayjobs.com", path: "/workday", expectedSite: "Workday" },
  { id: "greenhouse", host: "boards.greenhouse.io", path: "/greenhouse", expectedSite: "Greenhouse", expectedDrops: true },
  { id: "lever", host: "jobs.lever.co", path: "/lever", expectedSite: "Lever", expectedDrops: true },
  { id: "ashby", host: "ashby.fixture.test", path: "/ashby", expectedSite: "Ashby", expectedDrops: true },
  { id: "icims", host: "icims.fixture.test", path: "/icims", expectedSite: "Generic form", frame: "application-frame", expectedDrops: true },
  { id: "smartrecruiters", host: "smartrecruiters.fixture.test", path: "/smartrecruiters", expectedSite: "SmartRecruiters", expectedDrops: true },
  { id: "taleo", host: "taleo.fixture.test", path: "/taleo", expectedSite: "Oracle / Taleo", expectedDrops: true },
  { id: "northstarz", host: "northstarz.ai", path: "/northstarz", expectedSite: "Generic form" },
  { id: "react-dropzone", host: "apply.example.test", path: "/react-dropzone", expectedSite: "Generic form", dynamic: true }
]);

const ATS_MARKUP = Object.freeze({
  workday: '<div data-automation-id="progressBar"></div><h2 data-automation-id="applicationPageTitle">Application Questions</h2>',
  greenhouse: '<div class="greenhouse-job-board" aria-hidden="true"></div>',
  lever: '<div class="lever-job-application" aria-hidden="true"></div>',
  ashby: '<div data-ashby-job-posting aria-hidden="true"></div>',
  smartrecruiters: '<div data-test="application-form" aria-hidden="true"></div>',
  taleo: '<div class="taleo-application" aria-hidden="true"></div>',
  northstarz: '<div data-testid="northstarz-application" aria-hidden="true"></div>',
  "react-dropzone": '<div data-testid="generic-react-application" aria-hidden="true"></div>',
  icims: '<div class="iCIMS_Application" aria-hidden="true"></div>'
});

const CONTAINER = Object.freeze({
  workday: 'data-automation-id="formField"', greenhouse: 'class="field text-input-wrapper"',
  lever: 'class="application-question"', ashby: 'class="ashby-application-form-field-entry" data-testid="application-field"',
  smartrecruiters: 'class="form-group" data-test="application-field"',
  taleo: 'class="form-field" data-automation-id="formFieldCandidate"', northstarz: 'class="field"',
  "react-dropzone": 'class="field"', icims: 'class="iCIMS_FieldRow"'
});

const DROPZONE = Object.freeze({
  workday: 'class="file-upload" data-automation-id="resumeUpload"', greenhouse: 'class="file-upload drop-zone"',
  lever: 'class="resume-upload"', ashby: 'class="FileUpload" data-testid="resume-upload"',
  smartrecruiters: 'data-test="resume-upload"',
  taleo: 'data-automation-id="resume-upload"', northstarz: 'class="react-dropzone"',
  "react-dropzone": 'class="react-dropzone" data-testid="resume-dropzone"', icims: 'class="iCIMS_FileUpload"'
});

function field(type, id, label, attributes = "") {
  return `<div ${CONTAINER[type]}><label for="${id}">${escapeHtml(label)}</label><input id="${id}" name="${id}" ${attributes}></div>`;
}

function formMarkup(type) {
  const country = `<div ${CONTAINER[type]}><label for="country">Country of residence</label><select id="country" name="country" autocomplete="country-name" required><option value="">Select country</option><option value="United Kingdom">United Kingdom</option><option value="India">India</option></select></div>`;
  const workdayDate = type === "workday" ? `<fieldset data-automation-id="formField"><legend>What is your desired start date?</legend><input id="start-month" type="number" data-automation-id="dateSectionMonth" aria-label="Month"><input id="start-day" type="number" data-automation-id="dateSectionDay" aria-label="Day"><input id="start-year" type="number" data-automation-id="dateSectionYear" aria-label="Year"></fieldset>` : "";
  return `${ATS_MARKUP[type] || ""}<form id="fixture-form" class="fixture-form" novalidate>
    ${field(type, "first-name", "First name", 'autocomplete="given-name" required')}
    ${field(type, "last-name", "Last name", 'autocomplete="family-name" required')}
    ${field(type, "email", "Email address", 'type="email" autocomplete="email" value="existing@example.test" required')}
    ${field(type, "phone", "Phone number", 'type="tel" autocomplete="tel" required')}
    ${country}${workdayDate}
    ${field(type, "ssn", "Social Security Number", 'required')}
    ${field(type, "gender", "Gender / sex assigned at birth")}
    <div ${CONTAINER[type]}><label for="privacy-consent">I agree to the privacy policy</label><input id="privacy-consent" name="privacy-consent" type="checkbox" required></div>
    <div ${DROPZONE[type]} id="resume-dropzone"><label for="resume">Upload CV/Resume</label><input id="resume" name="resume" type="file" accept=".pdf,.doc,.docx,application/pdf"><output id="resume-widget">No file attached</output></div>
    <button id="next-action" type="button">Save and Continue</button><button id="submit-action" type="submit">Submit application</button>
  </form>`;
}

const TRACKING_SCRIPT = `
window.__fixture={events:{},drops:[],submitCount:0,nextClickCount:0,submitClickCount:0,record(id,event){const key=id+':'+event;this.events[key]=(this.events[key]||0)+1}};
for(const control of document.querySelectorAll('input,textarea,select'))for(const event of ['input','change'])control.addEventListener(event,()=>window.__fixture.record(control.id,event));
const resume=document.querySelector('#resume');if(resume)resume.addEventListener('change',()=>{document.querySelector('#resume-widget').textContent=resume.files?.[0]?.name||'No file attached'});
const dropzone=document.querySelector('#resume-dropzone');if(dropzone)for(const event of ['dragenter','dragover','drop'])dropzone.addEventListener(event,entry=>{entry.preventDefault();window.__fixture.drops.push(event)});
document.querySelector('#next-action')?.addEventListener('click',()=>window.__fixture.nextClickCount++);document.querySelector('#submit-action')?.addEventListener('click',()=>window.__fixture.submitClickCount++);
document.querySelector('#fixture-form')?.addEventListener('submit',event=>{event.preventDefault();window.__fixture.submitCount++});
window.addDynamicPhone=()=>{if(document.querySelector('#dynamic-phone'))return;const container=document.createElement('div');container.className='field';container.innerHTML='<label for="dynamic-phone">Phone number</label><input id="dynamic-phone" name="dynamic-phone" type="tel" required>';document.querySelector('#fixture-form').insertBefore(container,document.querySelector('#next-action'));const input=container.querySelector('input');for(const event of ['input','change'])input.addEventListener(event,()=>window.__fixture.record(input.id,event))};`;

function documentFor(type) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(type)} ATS regression fixture</title><style>
  body{font:16px/1.4 system-ui,sans-serif;margin:24px;color:#151515}form{display:grid;gap:14px;max-width:720px}form>div{display:grid;gap:5px;min-height:48px}input{box-sizing:border-box;min-height:34px;width:100%}input[type=checkbox]{height:20px;width:20px}.react-dropzone,.file-upload,.resume-upload,.FileUpload,.iCIMS_FileUpload{border:1px dashed #555;padding:12px}button{min-height:34px}</style></head>
  <body data-fixture="${escapeHtml(type)}"><h1>${escapeHtml(type)} application fixture</h1>${formMarkup(type)}<script>${TRACKING_SCRIPT}<\/script></body></html>`;
}

export function fixtureResponse(pathname) {
  if (pathname === "/health") return { status: 200, body: "ok", type: "text/plain; charset=utf-8" };
  if (pathname === "/favicon.ico") return { status: 204, body: "", type: "image/x-icon" };
  if (pathname === "/icims") return { status: 200, type: "text/html; charset=utf-8", body: '<!doctype html><html><head><meta charset="utf-8"><title>iCIMS frame fixture</title><style>iframe{width:900px;height:900px;border:0}</style></head><body><h1>iCIMS application</h1><iframe name="application-frame" src="/icims-inner"></iframe></body></html>' };
  if (pathname === "/icims-inner") return { status: 200, body: documentFor("icims"), type: "text/html; charset=utf-8" };
  const type = ATS_CASES.find((entry) => entry.path === pathname)?.id;
  if (type) return { status: 200, body: documentFor(type), type: "text/html; charset=utf-8" };
  return { status: 404, body: "Not found", type: "text/plain; charset=utf-8" };
}
