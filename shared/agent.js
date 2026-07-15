(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const BLOCKED_ACTION = /submit|apply|send|continue|next|captcha|assessment|test|sign|login|password|payment|consent|agree|accept terms/i;
  const BLOCKED_FIELD = /password|captcha|credit card|bank|social security|ssn|passport|aadhaar|government id|date of birth|race|ethnicity|gender|disability|veteran|religion|sexual orientation|consent|terms/i;
  const ALLOWED_ACTIONS = new Set(["fill", "select", "check", "skip"]);

  ApplyOS.isSafeAgentAction = function isSafeAgentAction(action = {}) {
    const kind = String(action.action || "").toLowerCase();
    const context = `${action.label || ""} ${action.selector || ""} ${action.value || ""}`;
    return ALLOWED_ACTIONS.has(kind) && !BLOCKED_ACTION.test(context) && !BLOCKED_FIELD.test(context);
  };

  ApplyOS.validateAgentPlan = function validateAgentPlan(plan = {}) {
    const rawActions = Array.isArray(plan.actions) ? plan.actions : [];
    const actions = rawActions.filter(ApplyOS.isSafeAgentAction).slice(0, 80).map((action) => ({
      action: String(action.action || "skip").toLowerCase(),
      fieldId: String(action.fieldId || ""),
      value: String(action.value ?? ""),
      label: String(action.label || ""),
      confidence: Math.max(0, Math.min(1, Number(action.confidence || 0)))
    })).filter((action) => action.fieldId && action.confidence >= 0.62);
    return { actions, notes: String(plan.notes || ""), reviewRequired: true, blockedActions: rawActions.length - actions.length };
  };

  ApplyOS.generateAgentPlan = async function generateAgentPlan(fields = [], profile = {}, job = {}) {
    if (!fields.length) return { actions: [], notes: "No empty review-safe fields were found.", reviewRequired: true, blockedActions: 0 };
    const prompt = `You are a review-first job application form assistant. Return ONLY valid JSON with this shape: {"actions":[{"action":"fill|select|check|skip","fieldId":"id from input","value":"exact value","label":"field label","confidence":0.0}],"notes":"short note"}.
Rules: Never invent facts. Never submit, apply, send, continue, click navigation, answer assessments, solve CAPTCHA, accept consent, or fill sensitive demographic/government/payment fields. Use only facts present in PROFILE. Prefer skip when uncertain. Keep confidence below 0.62 unless the answer is directly supported.
JOB: ${JSON.stringify({ company: job.company, role: job.role, location: job.location })}
PROFILE: ${JSON.stringify({
      name: profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" "), email: profile.email, phone: profile.phone,
      location: profile.currentLocation, links: { linkedin: profile.linkedin, github: profile.github, portfolio: profile.portfolio },
      experience: profile.employment || [{ company: profile.currentCompany, title: profile.currentTitle, description: profile.jobDescription }],
      education: profile.education || [{ school: profile.school, degree: profile.degree, fieldOfStudy: profile.fieldOfStudy }],
      preferences: { salary: profile.desiredSalary, notice: profile.noticePeriod, authorization: profile.workAuthorization, sponsorship: profile.visaSponsorship, remote: profile.remotePreference },
      savedAnswers: profile.customAnswers || []
    })}
FIELDS: ${JSON.stringify(fields.slice(0, 80))}`;
    const text = await ApplyOS.generateLocalText(prompt, { temperature: 0.1, json: true });
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = JSON.parse(String(text).match(/\{[\s\S]*\}/)?.[0] || "{}"); }
    return ApplyOS.validateAgentPlan(parsed);
  };
})(globalThis);
