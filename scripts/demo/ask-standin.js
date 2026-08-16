/* Installed as a string. Patches fetch so Ask can stream a paced stand-in. */
(() => {
  if (window.__nettAskStandin) return;
  window.__nettAskStandin = true;
  const existing = window.fetch;
  const directory = window.__nettDemoPeople || [];
  const byName = (name) => directory.find((row) => row.name === name) || { id: "demo-" + name, name };

  const kendraPack = () => {
    const kendra = byName("Kendra Mysore");
    const answer = [
      kendra.name + " [1] is your sister. You grew up together in Mysore. She is the person you call when the family thread needs holding — that is why she sits at the top of the record, not because a field says “priority.”",
      "She called last weekend about coming home in September, while Dad is in town. She asked whether you would be there for that week. Messages still has the question, word for word. The follow-up on September 8 is already on the record, waiting for you to be in the same city.",
      "You told her you will be home. She is bringing the photo albums. WhatsApp has the train times she said she would send. That note is stored as written. Nett did not invent it, and it will not overwrite it.",
      "What matters next is simple: be there that week. Everything else — hometown, languages, the family thread — is already recovered. The evidence is hers, not a guess about who she is.",
    ].join("\n\n");
    return {
      answer,
      citations: [
        { personId: kendra.id, label: kendra.name, field: "relationship", value: "Sister. Grew up together in Mysore. The person I call when I need the family thread held together.", source: "nett" },
        { personId: kendra.id, label: kendra.name, field: "quick_memories", value: "Can you be home the week Dad is in town in September?", source: "messages" },
        { personId: kendra.id, label: kendra.name, field: "notes", value: "Sending the train times when I have them.", source: "whatsapp" },
        { personId: kendra.id, label: kendra.name, field: "notes", value: "Will be home the week she visits. She is bringing the photo albums.", source: "nett" },
      ],
      provider: "ollama:llama3.2:3b",
      note: "Written on this Mac from owned evidence.",
    };
  };

  const synthesisPack = () => {
    const noor = byName("Noor Alvi");
    const ada = byName("Ada Fong");
    const dana = byName("Dana Ruiz");
    const jordan = byName("Jordan Lee");
    const answer = [
      "The live ask is " + noor.name + " [1]. Last week she asked who you knew who might care about court-record tooling. That is not an inferred interest — it is a question she put in front of you, in WhatsApp, and she is stuck on procurement. Start there.",
      ada.name + " [2] is the second thread. She marked the public-records sentence in the recognition essay and said if you ever wanted to talk civic data, she is in. She already did the thinking Noor is reaching for. The overlap is in the writing, not in a tag.",
      dana.name + " [3] just closed a pilot with two county clerks. She needs someone who already trusts the court-data problem. If you introduce Noor to Dana, you are connecting a live ask to someone who is already selling the same wound — a peer, not a cold lead.",
      jordan.name + " [4] is weaker, and that is useful. Coffee about a product roadmap, no next step — but he is the only person in technology who has been quiet long enough that a specific intro would give him a reason to answer. Do not lead with him.",
      "The relationship between these four is the point. Noor has the question. Ada has the civic-data sentence. Dana has the clerk pilot. Jordan has a dormant legal-ops ask. Nett did not search a directory for “legal tech.” It read overlapping conversations and kept the ones that cite each other.",
      "Start with Noor. The evidence is a question she asked you. Then Ada, because the overlap is already in the writing. Dana is the commercial close if Noor wants a peer who has shipped. Jordan waits.",
    ].join("\n\n");
    return {
      answer,
      citations: [
        { personId: noor.id, label: noor.name, field: "quick_memories", value: "Do you know anyone who would care about court-record tooling? I'm stuck on the procurement side.", source: "whatsapp" },
        { personId: noor.id, label: noor.name, field: "notes", value: "Product at Civic Docket. Asked for a court-records intro, not a generic legal-tech list.", source: "nett" },
        { personId: ada.id, label: ada.name, field: "notes", value: "The public-records paragraph is the one. If you ever want to talk civic data, I'm in.", source: "messages" },
        { personId: ada.id, label: ada.name, field: "interests", value: "Marked civic data and public records in the recognition essay.", source: "nett" },
        { personId: dana.id, label: dana.name, field: "quick_memories", value: "We just closed a pilot with two county clerks. Need someone who already trusts the court-data problem.", source: "whatsapp" },
        { personId: dana.id, label: dana.name, field: "notes", value: "Founder at Recordly. Selling the same wound Noor is stuck on.", source: "nett" },
        { personId: jordan.id, label: jordan.name, field: "notes", value: "If you ever meet someone in legal ops, I want an intro. Roadmap is stuck on compliance.", source: "messages" },
      ],
      provider: "ollama:llama3.2:3b",
      note: "Written on this Mac from overlapping conversations.",
    };
  };

  window.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.includes("/api/agent/query")) return existing(input, init);
    let query = "";
    try {
      query = String(JSON.parse(String(init && init.body ? init.body : "{}")).query || "");
    } catch {
      query = "";
    }
    const brief = /kendra/i.test(query);
    const synthesis = /legal tech|good lead|who might/i.test(query);
    if (!brief && !synthesis) return existing(input, init);

    const result = brief ? kendraPack() : synthesisPack();
    const stages = brief
      ? [
          { wait: 720, event: { type: "stage", id: "search", label: "Searching records" } },
          { wait: 1100, event: { type: "stage", id: "match", label: "Matched 1 person", detail: "local-evidence · Kendra Mysore" } },
          { wait: 980, event: { type: "stage", id: "messages", label: "Reading Messages", detail: "September visit · Dad in town" } },
          { wait: 920, event: { type: "stage", id: "whatsapp", label: "Reading WhatsApp", detail: "Train times she said she would send" } },
          { wait: 860, event: { type: "stage", id: "notes", label: "Pulling notes and memories", detail: "Sister · Mysore · photo albums" } },
          { wait: 780, event: { type: "stage", id: "write", label: "Writing with llama3.2:3b" } },
        ]
      : [
          { wait: 680, event: { type: "stage", id: "search", label: "Searching records" } },
          { wait: 1100, event: { type: "stage", id: "scan", label: "Scanning Messages and WhatsApp", detail: "owned threads only" } },
          { wait: 1200, event: { type: "stage", id: "match", label: "Matched 4 people", detail: "Noor · Ada · Dana · Jordan" } },
          { wait: 980, event: { type: "stage", id: "noor", label: "Reading Noor’s ask", detail: "WhatsApp · court-record tooling · procurement" } },
          { wait: 920, event: { type: "stage", id: "ada", label: "Reading Ada’s civic-data note", detail: "Messages · public-records sentence" } },
          { wait: 900, event: { type: "stage", id: "dana", label: "Reading Dana’s clerk pilot", detail: "WhatsApp · two county clerks" } },
          { wait: 1400, event: { type: "stage", id: "relate", label: "Connecting overlapping conversations", detail: "court records · civic data · legal ops" } },
          { wait: 820, event: { type: "stage", id: "write", label: "Writing with llama3.2:3b" } },
        ];

    const words = result.answer.split(/(\s+)/);
    const tokens = [];
    for (let i = 0; i < words.length; i += 4) tokens.push(words.slice(i, i + 4).join(""));

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event) => controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
        for (const stage of stages) {
          await new Promise((resolve) => setTimeout(resolve, stage.wait));
          send(stage.event);
        }
        await new Promise((resolve) => setTimeout(resolve, 360));
        send({ type: "meta", path: brief ? "person-brief" : "synthesis", provider: result.provider, citations: result.citations, note: result.note });
        for (const text of tokens) {
          await new Promise((resolve) => setTimeout(resolve, 56));
          send({ type: "token", text });
        }
        await new Promise((resolve) => setTimeout(resolve, 240));
        send({ type: "done", answer: result.answer, citations: result.citations, provider: result.provider, note: result.note });
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  };
})();
