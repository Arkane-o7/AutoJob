(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};
  const GRAPH_KEY = "applyos_graph";
  const GRAPH_VERSION = 1;

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function tokens(value) {
    return new Set(normalize(value).split(" ").filter((word) => word.length > 1));
  }

  function similarity(left, right) {
    if (ApplyOS.questionSimilarity) return ApplyOS.questionSimilarity(left, right);
    const a = tokens(left); const b = tokens(right);
    if (!a.size || !b.size) return 0;
    const overlap = [...a].filter((token) => b.has(token)).length;
    return overlap / Math.max(a.size, b.size);
  }

  function emptyGraph() {
    return { schema_version: GRAPH_VERSION, nodes: [], edges: [], rl_patterns: [], updated_at: ApplyOS.nowISO?.() || new Date().toISOString() };
  }

  function normalizeGraph(input) {
    const graph = { ...emptyGraph(), ...(input || {}) };
    graph.schema_version = GRAPH_VERSION;
    graph.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
    graph.rl_patterns = Array.isArray(graph.rl_patterns) ? graph.rl_patterns : [];
    return graph;
  }

  async function writeGraph(graph) {
    const normalized = normalizeGraph(graph);
    normalized.updated_at = ApplyOS.nowISO?.() || new Date().toISOString();
    await chrome.storage.local.set({ [GRAPH_KEY]: normalized });
    return normalized;
  }

  ApplyOS.GRAPH_KEY = GRAPH_KEY;
  ApplyOS.ensureGraph = async function ensureGraph() {
    const stored = await chrome.storage.local.get(GRAPH_KEY);
    return stored[GRAPH_KEY] ? normalizeGraph(stored[GRAPH_KEY]) : writeGraph(emptyGraph());
  };

  ApplyOS.mutateGraph = async function mutateGraph(mutator) {
    const current = await ApplyOS.ensureGraph();
    const next = (await mutator(structuredClone(current))) || current;
    return writeGraph(next);
  };

  ApplyOS.recordGraphAnswer = async function recordGraphAnswer(entry = {}) {
    const question = String(entry.question || "").trim();
    const answer = String(entry.answer || "").trim();
    if (!question || !answer) return null;
    let saved = null;
    await ApplyOS.mutateGraph((graph) => {
      const now = ApplyOS.nowISO?.() || new Date().toISOString();
      const canonical = entry.canonicalField || null;
      const existing = graph.nodes.find((node) => node.type === "answer" && (
        (canonical && node.canonical_field === canonical && normalize(node.answer) === normalize(answer)) ||
        (similarity(node.question, question) >= 0.9 && normalize(node.answer) === normalize(answer))
      ));
      if (existing) {
        existing.question = question;
        existing.answer = answer;
        existing.confidence = Math.max(Number(existing.confidence || 0.5), Number(entry.confidence || 0.7));
        existing.use_count = Number(existing.use_count || 0) + 1;
        existing.platforms = [...new Set([...(existing.platforms || []), entry.platform].filter(Boolean))];
        existing.updated_at = now;
        saved = existing;
      } else {
        saved = {
          id: ApplyOS.uid?.("graph") || `graph_${Date.now()}`,
          type: "answer", question, answer, canonical_field: canonical,
          prompt_type: entry.promptType || "free_text_short", source: entry.source || "memory",
          confidence: Number(entry.confidence || 0.7), use_count: 1,
          platforms: entry.platform ? [entry.platform] : [], created_at: now, updated_at: now
        };
        graph.nodes.push(saved);
      }
      if (entry.applicationId) {
        const edgeId = `${saved.id}:${entry.applicationId}`;
        if (!graph.edges.some((edge) => edge.id === edgeId)) graph.edges.push({ id: edgeId, from: saved.id, to: entry.applicationId, relation: "used_for", weight: 1, created_at: now });
      }
      graph.nodes = graph.nodes.slice(-1000);
      graph.edges = graph.edges.slice(-2000);
      return graph;
    });
    return saved;
  };

  ApplyOS.recordGraphCorrection = async function recordGraphCorrection(entry = {}) {
    const saved = await ApplyOS.recordGraphAnswer({ ...entry, answer: entry.correctedValue || entry.answer, source: "user_correction", confidence: 1 });
    if (!saved) return null;
    await ApplyOS.reinforceGraphResult({ fingerprint: entry.fingerprint || saved.id, success: true, corrected: true, canonicalField: entry.canonicalField });
    return saved;
  };

  ApplyOS.bestGraphAnswer = async function bestGraphAnswer(question, context = {}) {
    const graph = await ApplyOS.ensureGraph();
    let best = null;
    for (const node of graph.nodes.filter((item) => item.type === "answer")) {
      let score = similarity(question, node.question) * 0.68;
      if (context.canonicalField && node.canonical_field === context.canonicalField) score += 0.22;
      if (context.platform && node.platforms?.includes(context.platform)) score += 0.06;
      score += Math.min(Number(node.use_count || 0), 10) * 0.004;
      score *= Math.max(0.5, Number(node.confidence || 0.7));
      if (!best || score > best.score) best = { ...node, score };
    }
    return best?.score >= 0.56 ? best : null;
  };

  ApplyOS.reinforceGraphResult = async function reinforceGraphResult(event = {}) {
    if (!event.fingerprint) return null;
    let updated = null;
    await ApplyOS.mutateGraph((graph) => {
      const now = ApplyOS.nowISO?.() || new Date().toISOString();
      updated = graph.rl_patterns.find((pattern) => pattern.fingerprint === event.fingerprint);
      if (!updated) {
        updated = { id: ApplyOS.uid?.("rl") || `rl_${Date.now()}`, fingerprint: event.fingerprint, canonical_field: event.canonicalField || null, successes: 0, failures: 0, corrections: 0, weight: 0.5, created_at: now };
        graph.rl_patterns.push(updated);
      }
      if (event.success) updated.successes += 1; else updated.failures += 1;
      if (event.corrected) updated.corrections += 1;
      const observations = updated.successes + updated.failures + updated.corrections;
      updated.weight = Math.max(0.05, Math.min(0.98, (updated.successes + 1) / (observations + 2)));
      updated.updated_at = now;
      graph.rl_patterns = graph.rl_patterns.slice(-1000);
      return graph;
    });
    return updated;
  };

  ApplyOS.graphStats = async function graphStats() {
    const graph = await ApplyOS.ensureGraph();
    return {
      answers: graph.nodes.filter((node) => node.type === "answer").length,
      corrections: graph.nodes.filter((node) => node.source === "user_correction").length,
      relationships: graph.edges.length,
      learnedPatterns: graph.rl_patterns.length
    };
  };
})(globalThis);
