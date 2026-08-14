/* Local Ollama services adapted from Offlyn Apply under the MIT License. */
(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const CONFIG_KEY = "ollamaConfig";
  const DEFAULTS = { endpoint: "http://localhost:11434", chatModel: "llama3.2", embeddingModel: "nomic-embed-text", enabled: false, lastChecked: 0, version: "" };

  ApplyOS.getAIConfig = async function getAIConfig() {
    const stored = await chrome.storage.local.get(CONFIG_KEY);
    return { ...DEFAULTS, ...(stored[CONFIG_KEY] || {}) };
  };

  ApplyOS.saveAIConfig = async function saveAIConfig(patch) {
    const config = { ...(await ApplyOS.getAIConfig()), ...(patch || {}) };
    config.endpoint = String(config.endpoint || DEFAULTS.endpoint).replace(/\/+$/, "");
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
    return config;
  };

  ApplyOS.ollamaProxy = async function ollamaProxy(request = {}) {
    const config = await ApplyOS.getAIConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(request.timeout || 120000));
    try {
      const response = await fetch(`${config.endpoint}${request.path || "/api/version"}`, {
        method: request.method || (request.body ? "POST" : "GET"),
        headers: request.body ? { "Content-Type": "application/json" } : undefined,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      let data = text;
      try { data = text ? JSON.parse(text) : {}; } catch { /* Streaming/plain-text responses stay strings. */ }
      if (!response.ok) throw new Error(data?.error || `Ollama returned HTTP ${response.status}`);
      return { ok: true, data, status: response.status };
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Ollama request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  async function requestOllama(request) {
    if (typeof document === "undefined") return ApplyOS.ollamaProxy(request);
    const response = await chrome.runtime.sendMessage({ type: "APPLYOS_OLLAMA_PROXY", payload: request });
    if (!response?.ok) throw new Error(response?.error || "Ollama request failed");
    return response;
  }

  ApplyOS.testAIConnection = async function testAIConnection() {
    try {
      const [response, tags] = await Promise.all([
        requestOllama({ path: "/api/version", timeout: 8000 }),
        requestOllama({ path: "/api/tags", timeout: 8000 })
      ]);
      const version = response.data?.version || "unknown";
      const current = await ApplyOS.getAIConfig();
      const modelRecords = tags.data?.models || [];
      const models = modelRecords.map((item) => item.name || item.model).filter(Boolean);
      const requested = current.chatModel;
      let selectedModel = models.find((name) => name === requested || name === `${requested}:latest` || `${name}:latest` === requested);
      if (!selectedModel) {
        selectedModel = modelRecords
          .filter((item) => (item.capabilities || []).includes("completion") && !item.remote_host)
          .sort((left, right) => Number(left.size || Infinity) - Number(right.size || Infinity))
          .map((item) => item.name || item.model)[0];
      }
      const modelAvailable = Boolean(selectedModel);
      if (!modelAvailable) {
        await ApplyOS.saveAIConfig({ enabled: false, lastChecked: Date.now(), version });
        return { success: false, connected: true, version, models, error: "Ollama is connected, but no installed text-generation model was found. Smart Tools remain available." };
      }
      const config = await ApplyOS.saveAIConfig({ enabled: true, chatModel: selectedModel, lastChecked: Date.now(), version });
      return { success: true, version, config, autoSelected: selectedModel !== requested };
    } catch (error) {
      await ApplyOS.saveAIConfig({ enabled: false, lastChecked: Date.now(), version: "" });
      return { success: false, error: error.message };
    }
  };

  ApplyOS.generateLocalText = async function generateLocalText(prompt, options = {}) {
    const config = await ApplyOS.getAIConfig();
    if (!config.enabled && !options.allowDisabled) throw new Error("Local AI is disabled. Connect Ollama in onboarding or settings.");
    const response = await requestOllama({
      path: "/api/generate",
      timeout: options.timeout || 180000,
      body: {
        model: options.model || config.chatModel,
        prompt: String(prompt || ""),
        stream: false,
        format: options.json || options.format === "json" ? "json" : undefined,
        options: { temperature: options.temperature ?? 0.25, num_predict: options.maxTokens || 3072 }
      }
    });
    return String(response.data?.response || "").trim();
  };

  ApplyOS.getLocalEmbedding = async function getLocalEmbedding(text) {
    const config = await ApplyOS.getAIConfig();
    const response = await requestOllama({ path: "/api/embeddings", body: { model: config.embeddingModel, prompt: String(text || "").slice(0, 8000) } });
    return response.data?.embedding || [];
  };

  ApplyOS.cosineSimilarity = function cosineSimilarity(left = [], right = []) {
    if (!left.length || left.length !== right.length) return 0;
    let dot = 0; let a = 0; let b = 0;
    for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; a += left[index] ** 2; b += right[index] ** 2; }
    return a && b ? dot / (Math.sqrt(a) * Math.sqrt(b)) : 0;
  };

  function cleanGeneratedText(value) {
    return String(value || "")
      .replace(/^(?:here (?:is|are).*?:|sure[,!]?.*?:|of course[,!]?.*?:)\s*/i, "")
      .replace(/^['"]|['"]$/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function profileName(profile = {}) {
    return profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "the applicant";
  }

  function compactEvidence(value, max = 360) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max).replace(/[,;:]?\s+\S*$/, "")}…`;
  }

  ApplyOS.generateSmartCoverLetter = function generateSmartCoverLetter(application = {}, profile = {}) {
    const match = ApplyOS.calculateMatch?.(application.description || "", profile) || { matchedSkills: [], suggestedKeywords: [] };
    const name = profileName(profile);
    const title = profile.currentTitle || profile.employment?.[0]?.title || "my recent work";
    const company = profile.currentCompany || profile.employment?.[0]?.company || "";
    const evidence = compactEvidence(profile.jobDescription || profile.employment?.[0]?.description || profile.coverLetter, 420);
    const skills = (match.matchedSkills || []).slice(0, 5);
    const alignment = skills.length ? skills.join(", ") : "the responsibilities described in the role";
    const experience = evidence
      ? `In ${title}${company ? ` at ${company}` : ""}, ${evidence.charAt(0).toLowerCase()}${evidence.slice(1)}`
      : `My background aligns with ${alignment}, and I would welcome the opportunity to discuss the most relevant examples.`;
    const text = [
      `I am writing to apply for the ${application.role || "open position"} role at ${application.company || "your company"}. My experience with ${alignment} closely matches the priorities described in the position.`,
      experience,
      `I am particularly interested in contributing to ${application.company || "the team"} in this role and bringing a thoughtful, practical approach to the work. I would value the opportunity to discuss how my experience can support the team’s goals.`,
      `Thank you for your time and consideration.\n\n${name}`
    ].filter(Boolean).join("\n\n");
    return { text, jobTitle: application.role, company: application.company, generatedAt: Date.now(), provider: "applyos-smart", reviewRequired: true };
  };

  ApplyOS.buildSmartResumeFocusPlan = function buildSmartResumeFocusPlan(application = {}, profile = {}) {
    const match = ApplyOS.calculateMatch?.(application.description || "", profile) || { score: 0, matchedSkills: [], missingSkills: [], suggestedKeywords: [], suggestedExperiences: [] };
    const verified = (match.matchedSkills || []).slice(0, 12);
    const verifyFirst = (match.missingSkills || []).slice(0, 12);
    const lines = [
      `RESUME FOCUS PLAN — ${application.role || "ROLE"} AT ${application.company || "COMPANY"}`,
      `Current local match: ${match.score || 0}%`,
      "",
      "MOVE HIGHER / EMPHASIZE",
      verified.length ? verified.map((item) => `• ${item}`).join("\n") : "• No explicit overlapping skills detected yet.",
      "",
      "EXPERIENCE TO HIGHLIGHT",
      (match.suggestedExperiences || []).length ? match.suggestedExperiences.map((item) => `• ${item}`).join("\n") : `• ${compactEvidence(profile.jobDescription || profile.employment?.[0]?.description, 360) || "Add your strongest relevant project or outcome."}`,
      "",
      "VERIFY BEFORE ADDING",
      verifyFirst.length ? verifyFirst.map((item) => `• ${item} — include only if genuinely supported by your experience.`).join("\n") : "• No major missing keywords detected.",
      "",
      "MANUAL REVIEW",
      "• Keep all employers, dates, education, achievements, and metrics factual.",
      "• Use the job’s wording only where it accurately describes your experience."
    ];
    return { tailoredResume: lines.join("\n"), generatedAt: Date.now(), resumeVersionId: application.resume_version_id || null, provider: "applyos-smart", reviewRequired: true };
  };

  ApplyOS.analyzeKeywordGapLocal = function analyzeKeywordGapLocal(application = {}, profile = {}) {
    const match = ApplyOS.calculateMatch?.(application.description || "", profile) || {};
    return { present: match.matchedSkills || [], missing: match.missingSkills || [], highlights: match.suggestedExperiences || [], score: Number(match.score || 0), provider: "applyos-smart" };
  };

  ApplyOS.generateAICoverLetter = async function generateAICoverLetter(application, profile = {}) {
    const config = await ApplyOS.getAIConfig();
    if (!config.enabled) return ApplyOS.generateSmartCoverLetter(application, profile);
    const resumeText = ApplyOS.profileResumeText?.(profile) || "";
    const prompt = `You are writing a professional cover letter for a job application.

APPLICANT RESUME AND PROFILE:
${resumeText.slice(0, 8000)}

TARGET ROLE: ${application.role}
COMPANY: ${application.company}
LOCATION: ${application.location || "Not specified"}

JOB DESCRIPTION:
${String(application.description || "").slice(0, 7000)}

Write only the cover-letter body. Use 3-4 concise paragraphs and 250-350 words. Connect real applicant evidence to the role's requirements. Do not invent skills, employers, education, metrics, or achievements. Do not include placeholders, recipient addresses, a salutation, or a signature. The user will review it before use.`;
    try {
      const text = cleanGeneratedText(await ApplyOS.generateLocalText(prompt, { temperature: 0.35, maxTokens: 1400 }));
      return { text, jobTitle: application.role, company: application.company, generatedAt: Date.now(), provider: "ollama", reviewRequired: true };
    } catch {
      return { ...ApplyOS.generateSmartCoverLetter(application, profile), fallbackReason: "Local AI was unavailable" };
    }
  };

  ApplyOS.refineAICoverLetter = async function refineAICoverLetter(text, action) {
    const instructions = {
      shorten: "Reduce this to 150-200 words while retaining the strongest evidence.",
      lengthen: "Expand this to 350-450 words using only existing facts.",
      impactful: "Use stronger action verbs and clearer value while preserving every fact."
    };
    return cleanGeneratedText(await ApplyOS.generateLocalText(`Revise the cover letter below. ${instructions[action] || instructions.impactful}\nOutput only the revised body. Never invent information.\n\n${text}`, { temperature: 0.25, maxTokens: 1600 }));
  };

  ApplyOS.tailorResumeWithAI = async function tailorResumeWithAI(application, profile = {}) {
    const config = await ApplyOS.getAIConfig();
    if (!config.enabled) return ApplyOS.buildSmartResumeFocusPlan(application, profile);
    const resumeText = ApplyOS.profileResumeText?.(profile) || "";
    if (!resumeText) throw new Error("Add resume text or profile experience before tailoring.");
    const prompt = `You are an expert resume editor. Tailor the resume for the job while preserving every fact.

RULES:
- Do not fabricate experience, skills, companies, dates, education, or metrics.
- Reorder and rephrase only existing content.
- Emphasize evidence relevant to the job description.
- Incorporate truthful job keywords naturally.
- Return only the tailored resume text.

RESUME:
${resumeText.slice(0, 10000)}

JOB DESCRIPTION:
${String(application.description || "").slice(0, 8000)}`;
    try {
      const tailoredResume = cleanGeneratedText(await ApplyOS.generateLocalText(prompt, { temperature: 0.2, maxTokens: 4096 }));
      return { tailoredResume, generatedAt: Date.now(), resumeVersionId: application.resume_version_id || null, provider: "ollama", reviewRequired: true };
    } catch {
      return { ...ApplyOS.buildSmartResumeFocusPlan(application, profile), fallbackReason: "Local AI was unavailable" };
    }
  };

  ApplyOS.analyzeKeywordGapWithAI = async function analyzeKeywordGapWithAI(application, profile = {}) {
    const config = await ApplyOS.getAIConfig();
    if (!config.enabled) return ApplyOS.analyzeKeywordGapLocal(application, profile);
    const prompt = `Compare the resume and job description. Return only JSON matching {"present":[],"missing":[],"score":0,"highlights":[]}.
Only include skills or qualifications explicitly present in the supplied text.

RESUME:\n${(ApplyOS.profileResumeText?.(profile) || "").slice(0, 9000)}

JOB DESCRIPTION:\n${String(application.description || "").slice(0, 7000)}`;
    const raw = await ApplyOS.generateLocalText(prompt, { json: true, temperature: 0.1, maxTokens: 1200 });
    try {
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
      return { present: Array.isArray(parsed.present) ? parsed.present : [], missing: Array.isArray(parsed.missing) ? parsed.missing : [], highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [], score: Math.max(0, Math.min(100, Number(parsed.score) || 0)) };
    } catch {
      return ApplyOS.analyzeKeywordGapLocal(application, profile);
    }
  };
})(globalThis);
