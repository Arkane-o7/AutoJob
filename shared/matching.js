(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const STOPWORDS = new Set("a an and are as at be been but by can company could did do does for from had has have how i if in into is it job may more most not of on or our role should so than that the their them they this to us we what when where which who will with you your years work working".split(" "));
  const SKILLS = {
    javascript: ["javascript", "js", "ecmascript"],
    typescript: ["typescript", "ts"],
    python: ["python"],
    java: ["java"],
    "c++": ["c++", "cpp"],
    "c#": ["c#", "c sharp"],
    go: ["golang", " go "],
    rust: ["rust"],
    react: ["react", "reactjs", "react.js"],
    angular: ["angular"],
    vue: ["vue", "vue.js", "vuejs"],
    node: ["node.js", "nodejs", "node"],
    sql: ["sql", "postgres", "postgresql", "mysql"],
    mongodb: ["mongodb", "mongo"],
    redis: ["redis"],
    aws: ["aws", "amazon web services"],
    azure: ["azure"],
    gcp: ["gcp", "google cloud"],
    docker: ["docker", "containerization", "containers"],
    kubernetes: ["kubernetes", "k8s"],
    terraform: ["terraform", "infrastructure as code"],
    git: ["git", "github", "gitlab"],
    linux: ["linux", "unix"],
    rest: ["rest api", "restful", "rest APIs"],
    graphql: ["graphql"],
    microservices: ["microservices", "micro services"],
    "machine learning": ["machine learning", "ml models", "ml engineering"],
    "deep learning": ["deep learning", "neural networks"],
    llm: ["llm", "large language model", "foundation model", "generative ai", "genai"],
    nlp: ["natural language processing", "nlp"],
    pytorch: ["pytorch"],
    tensorflow: ["tensorflow"],
    pandas: ["pandas"],
    numpy: ["numpy"],
    spark: ["apache spark", "pyspark", "spark"],
    kafka: ["kafka"],
    airflow: ["airflow"],
    dbt: ["dbt"],
    tableau: ["tableau"],
    powerbi: ["power bi", "powerbi"],
    excel: ["excel", "spreadsheets"],
    figma: ["figma"],
    agile: ["agile", "scrum"],
    leadership: ["leadership", "led a team", "team lead"],
    communication: ["communication", "stakeholder management", "cross functional"]
  };

  function normalize(value) {
    return ` ${String(value || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim()} `;
  }

  function tokenize(value) {
    return normalize(value).trim().split(" ").filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
  }

  function objectText(value, depth = 0) {
    if (depth > 4 || value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map((item) => objectText(item, depth + 1)).join(" ");
    if (typeof value === "object") {
      return Object.entries(value)
        .filter(([key]) => !/dataUrl|base64|resume/i.test(key))
        .map(([, item]) => objectText(item, depth + 1))
        .join(" ");
    }
    return "";
  }

  ApplyOS.extractSkills = function extractSkills(text) {
    const haystack = normalize(text);
    return Object.entries(SKILLS)
      .filter(([, aliases]) => aliases.some((alias) => haystack.includes(` ${alias.toLowerCase()} `) || haystack.includes(alias.toLowerCase())))
      .map(([skill]) => skill);
  };

  ApplyOS.extractKeywords = function extractKeywords(text, limit = 24) {
    const counts = new Map();
    tokenize(text).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([token]) => token);
  };

  ApplyOS.questionSimilarity = function questionSimilarity(left, right) {
    const a = new Set(tokenize(left));
    const b = new Set(tokenize(right));
    if (!a.size || !b.size) return 0;
    const intersection = [...a].filter((token) => b.has(token)).length;
    return intersection / Math.max(a.size, b.size);
  };

  ApplyOS.calculateMatch = function calculateMatch(description, profile = {}) {
    const jobText = String(description || "");
    const profileText = objectText(profile);
    const jobSkills = ApplyOS.extractSkills(jobText);
    const profileSkills = ApplyOS.extractSkills(profileText);
    const matchedSkills = jobSkills.filter((skill) => profileSkills.includes(skill));
    const missingSkills = jobSkills.filter((skill) => !profileSkills.includes(skill));
    const jobKeywords = ApplyOS.extractKeywords(jobText, 30);
    const profileTokens = new Set(tokenize(profileText));
    const matchedKeywords = jobKeywords.filter((keyword) => profileTokens.has(keyword));
    const keywordScore = jobKeywords.length ? matchedKeywords.length / Math.min(jobKeywords.length, 20) : 0;
    const skillScore = jobSkills.length ? matchedSkills.length / jobSkills.length : keywordScore;
    const score = Math.max(0, Math.min(100, Math.round((skillScore * 0.72 + keywordScore * 0.28) * 100)));
    const suggestedKeywords = [...missingSkills, ...jobKeywords.filter((keyword) => !profileTokens.has(keyword))].slice(0, 12);
    const experiences = [profile.jobDescription, profile.coverLetter, profile.currentTitle, profile.currentCompany]
      .filter(Boolean)
      .map(String)
      .filter((item) => matchedSkills.some((skill) => normalize(item).includes(skill)))
      .slice(0, 3);

    return {
      score,
      jobSkills,
      matchedSkills,
      missingSkills,
      suggestedKeywords,
      suggestedExperiences: experiences,
      suggestedAnswers: {
        about: profile.coverLetter || "Connect your strongest relevant experience to the role's top requirements.",
        role: `Highlight ${matchedSkills.slice(0, 3).join(", ") || "your most relevant experience"} and one measurable outcome.`,
        gaps: missingSkills.length ? `Be ready to address: ${missingSkills.slice(0, 5).join(", ")}.` : "No major explicit skill gaps detected."
      }
    };
  };
})(globalThis);
