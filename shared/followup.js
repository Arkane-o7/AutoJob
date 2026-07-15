(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};

  ApplyOS.buildFollowUpReminders = function buildFollowUpReminders(application, appliedAt = new Date()) {
    const base = appliedAt instanceof Date ? appliedAt : new Date(appliedAt);
    return [
      {
        id: ApplyOS.uid("rem"),
        application_id: application.id,
        type: "follow_up",
        due_at: ApplyOS.addDays(base, 7),
        completed_at: null,
        created_at: ApplyOS.nowISO()
      },
      {
        id: ApplyOS.uid("rem"),
        application_id: application.id,
        type: "final_follow_up",
        due_at: ApplyOS.addDays(base, 14),
        completed_at: null,
        created_at: ApplyOS.nowISO()
      }
    ];
  };

  ApplyOS.generateFollowUpDraft = function generateFollowUpDraft(application, profile = {}, type = "follow_up") {
    const fullName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Your name";
    const isFinal = type === "final_follow_up";
    const subject = `${isFinal ? "Final follow-up" : "Following up"} — ${application.role} at ${application.company}`;
    const opening = isFinal
      ? `I wanted to send one final follow-up regarding my application for the ${application.role} position at ${application.company}.`
      : `I’m following up on my application for the ${application.role} position at ${application.company}.`;
    const relevance = application.matched_skills?.length
      ? `My experience with ${application.matched_skills.slice(0, 3).join(", ")} aligns especially well with the role.`
      : "I remain very interested in the role and the opportunity to contribute to your team.";
    const body = [
      "Hello hiring team,",
      "",
      opening,
      relevance,
      "",
      "I’d be happy to provide any additional information that would be useful. Thank you for your time and consideration.",
      "",
      "Best,",
      fullName,
      profile.linkedin || profile.portfolio || ""
    ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trim();

    return { subject, body, generated_at: ApplyOS.nowISO(), type };
  };
})(globalThis);
