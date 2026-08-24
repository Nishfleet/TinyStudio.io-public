const agentForm = document.querySelector("[data-agent-form]");
const agentStatus = document.querySelector("[data-agent-status]");
const agentOutput = document.querySelector("[data-agent-output]");
const outputEmpty = document.querySelector("[data-output-empty]");
const outputTitle = document.querySelector("[data-output-title]");
const copyButton = document.querySelector("[data-copy-output]");
const outputTabs = [...document.querySelectorAll("[data-output-tab]")];

const EMPTY_OUTPUT_TEXT =
  "Your generated system will appear here: Pipeline Brief, Implementation Checklist, and Weekly Fix Report.";
const SECTION_LABELS = {
  pipelineBrief: "Pipeline Brief",
  implementationChecklist: "Implementation Checklist",
  weeklyFixReport: "Weekly Fix Report"
};
const ERROR_MESSAGES = {
  ai_unavailable: "The AI desk is not available right now. Try again shortly.",
  cross_site_blocked: "Open TinyStudio.io directly and run the agents from this page.",
  daily_email_limit: "That email has reached today's run limit. Try again tomorrow.",
  daily_ip_limit: "This connection has reached today's run limit. Try again tomorrow.",
  empty_agent_output: "The agents could not produce a useful brief. Try again in a moment.",
  invalid_email: "Add a valid email address.",
  invalid_input: "Add email and a business snapshot first.",
  method_not_allowed: "That request type is not supported.",
  request_too_large: "That intake is too long. Shorten it and run the agents again.",
  same_origin_required: "Open TinyStudio.io directly and run the agents from this page.",
  storage_unavailable: "The signup and run tracker is unavailable right now. Try again shortly.",
  unsupported_media_type: "Refresh the page and run the agents again."
};

let copyResetTimer;
let activeSection = "pipelineBrief";
let currentSections = {
  pipelineBrief: "",
  implementationChecklist: "",
  weeklyFixReport: ""
};

function setStatus(message, state = "") {
  if (!agentStatus || !agentForm) return;
  agentStatus.textContent = message;
  if (state) {
    agentForm.dataset.state = state;
  } else {
    delete agentForm.dataset.state;
  }
}

function resetCopyButton() {
  if (!copyButton) return;
  if (copyResetTimer) {
    clearTimeout(copyResetTimer);
    copyResetTimer = undefined;
  }
  copyButton.textContent = "Copy section";
  copyButton.disabled = true;
}

function showEmpty(message = EMPTY_OUTPUT_TEXT) {
  if (!agentOutput || !outputEmpty) return;
  currentSections = {
    pipelineBrief: "",
    implementationChecklist: "",
    weeklyFixReport: ""
  };
  setActiveSection("pipelineBrief");
  agentOutput.textContent = "";
  agentOutput.hidden = true;
  outputEmpty.textContent = message;
  outputEmpty.hidden = false;
  resetCopyButton();
}

function normalizeSections(data) {
  const sections = data?.sections || {};
  return {
    pipelineBrief: sections.pipelineBrief || data?.brief || "",
    implementationChecklist: sections.implementationChecklist || "",
    weeklyFixReport: sections.weeklyFixReport || ""
  };
}

function activeSectionText() {
  return currentSections[activeSection] || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(value) {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderTable(rows) {
  const parsedRows = rows
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean));
  const dataRows = parsedRows.filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
  if (!dataRows.length) return "";

  const [head, ...body] = dataRows;
  return [
    "<table>",
    `<thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>`,
    `<tbody>${body.map((cells) => `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>"
  ].join("");
}

function renderMarkdown(markdown, sectionKey) {
  const title = SECTION_LABELS[sectionKey];
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listItems = [];
  let tableRows = [];
  let paragraph = [];

  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  const flushTable = () => {
    if (!tableRows.length) return;
    html.push(renderTable(tableRows));
    tableRows = [];
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);

    if (!trimmed) {
      flushList();
      flushTable();
      flushParagraph();
      return;
    }

    if (trimmed.startsWith("|")) {
      flushList();
      flushParagraph();
      tableRows.push(trimmed);
      return;
    }

    flushTable();

    if (heading) {
      flushList();
      flushParagraph();
      if (index === 0 && heading[1].trim() === title) return;
      html.push(`<h3>${inlineMarkdown(heading[1])}</h3>`);
      return;
    }

    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushList();
  flushTable();
  flushParagraph();

  return html.join("") || `<p>${EMPTY_OUTPUT_TEXT}</p>`;
}

function setActiveSection(sectionKey) {
  if (!SECTION_LABELS[sectionKey]) return;
  activeSection = sectionKey;

  outputTabs.forEach((tab) => {
    const selected = tab.dataset.outputTab === sectionKey;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });

  if (outputTitle) {
    outputTitle.textContent = SECTION_LABELS[sectionKey];
  }

  if (!agentOutput || !outputEmpty || !copyButton) return;

  const text = activeSectionText();
  agentOutput.innerHTML = renderMarkdown(text, sectionKey);
  agentOutput.hidden = !text;
  agentOutput.setAttribute("aria-labelledby", `output-tab-${sectionKey}`);
  outputEmpty.hidden = Boolean(text);
  if (!text) {
    outputEmpty.textContent = EMPTY_OUTPUT_TEXT;
  }
  copyButton.disabled = !text;
  copyButton.textContent = "Copy section";
}

function showAgentOutput(data) {
  if (!agentOutput || !outputEmpty || !copyButton) return;
  currentSections = normalizeSections(data);
  outputEmpty.hidden = true;
  setActiveSection("pipelineBrief");
}

agentForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitButton = agentForm.querySelector("button[type='submit']");
  const formData = new FormData(agentForm);
  const payload = Object.fromEntries(formData.entries());

  if (!payload.email || !payload.business) {
    showEmpty("Add the minimum context to generate a fresh pipeline loop.");
    setStatus("Add email and a business snapshot first.", "error");
    return;
  }

  submitButton.disabled = true;
  showEmpty("Agents are building the brief, checklist, and weekly report...");
  setStatus("Agents are building the pipeline loop...");

  try {
    const response = await fetch("/api/agent-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(data.message || ERROR_MESSAGES[data.error] || "The agents could not finish.");
    }

    showAgentOutput(data);
    setStatus("Pipeline loop generated. Review before using anything in campaigns.", "saved");
  } catch (error) {
    showEmpty("No current output is available after that failed run. Fix the issue and run the agents again.");
    setStatus(error.message || "That did not work. Try again in a moment.", "error");
  } finally {
    submitButton.disabled = false;
  }
});

outputTabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveSection(tab.dataset.outputTab));
  tab.addEventListener("keydown", (event) => {
    const currentIndex = outputTabs.indexOf(tab);
    const lastIndex = outputTabs.length - 1;
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === "ArrowLeft") {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = outputTabs[nextIndex];
    nextTab.focus();
    setActiveSection(nextTab.dataset.outputTab);
  });
});

copyButton?.addEventListener("click", async () => {
  const text = activeSectionText();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied";
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyButton.textContent = "Copy section";
      copyResetTimer = undefined;
    }, 1400);
  } catch {
    setStatus("Copy failed. Select the output and copy manually.", "error");
  }
});
