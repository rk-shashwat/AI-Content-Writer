/* ==========================================================
   AI Code Explainer — script.js
   Vanilla JS logic + Groq API integration
   ========================================================== */

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
// NOTE: Storing an API key in client-side JS means anyone who
// views the page source or devtools can see and use it.
// Fine for local/personal use — for a public deployment, route
// this request through your own backend so the key never
// reaches the browser.
const BACKEND_URL = "https://ai-tool-backend-dr0k.onrender.com/chat";
// ------------------------------------------------------------
// DOM REFERENCES
// ------------------------------------------------------------
const languageSelect = document.getElementById("languageSelect");
const explanationTypeSelect = document.getElementById("explanationType");
const codeInput = document.getElementById("codeInput");
const charCounter = document.getElementById("charCounter");
const lineCounter = document.getElementById("lineCounter");

const explainBtn = document.getElementById("explainBtn");
const clearBtn = document.getElementById("clearBtn");

const resultSection = document.getElementById("resultSection");
const explanationOutput = document.getElementById("explanationOutput");
const copyBtn = document.getElementById("copyBtn");
const downloadTxtBtn = document.getElementById("downloadTxtBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const explainAgainBtn = document.getElementById("explainAgainBtn");

const toastContainer = document.getElementById("toastContainer");

// Keep the last raw AI response in memory for copy/download/re-explain
let lastRawExplanation = "";

// ------------------------------------------------------------
// UTILITY: Toast notifications
// ------------------------------------------------------------
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ------------------------------------------------------------
// UTILITY: Auto-resize the code textarea as the user types
// ------------------------------------------------------------
function autoResizeTextarea() {
  codeInput.style.height = "auto";
  codeInput.style.height = `${codeInput.scrollHeight}px`;
}

// ------------------------------------------------------------
// UTILITY: Live character + line counters
// ------------------------------------------------------------
function updateCodeStats() {
  const value = codeInput.value;
  const chars = value.length;
  const lines = value === "" ? 0 : value.split("\n").length;
  charCounter.textContent = `${chars.toLocaleString()} character${chars === 1 ? "" : "s"}`;
  lineCounter.textContent = `${lines.toLocaleString()} line${lines === 1 ? "" : "s"}`;
}

// ------------------------------------------------------------
// UTILITY: Toggle the loading state of the Explain button
// ------------------------------------------------------------
function setLoading(isLoading) {
  explainBtn.disabled = isLoading;
  explainBtn.classList.toggle("loading", isLoading);
  explainBtn.querySelector(".btn-label").textContent = isLoading
    ? "Explaining..."
    : "Explain Code";
}

// ------------------------------------------------------------
// UTILITY: Build the prompt sent to the AI
// ------------------------------------------------------------
function buildPrompt(language, explanationType, code) {
  return `You are an expert software engineer and programming mentor.

Analyze the following code.

Programming Language:
${language}

Explanation Type:
${explanationType}

Code:

${code}

Return your response using the following format:

## Overall Explanation

Explain what the code does.

## Line-by-Line Explanation

Explain each important line or block.

## Time Complexity

Mention Big-O notation and explain why.

## Space Complexity

Mention memory usage.

## Potential Bugs

Identify possible bugs, edge cases, or security issues.

## Optimization Suggestions

Suggest improvements for readability, performance, and maintainability.

## Best Practices

List coding best practices relevant to this code.

Use beginner-friendly language while remaining technically accurate.`;
}

// ------------------------------------------------------------
// UTILITY: Escape HTML special characters
// ------------------------------------------------------------
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ------------------------------------------------------------
// UTILITY: Render inline markdown (bold + inline code)
// ------------------------------------------------------------
function renderInline(text) {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return escaped;
}

// ------------------------------------------------------------
// CORE: Parse the AI's markdown-ish response into HTML blocks
// Returns an array of HTML strings, one per visual block, so
// they can be revealed progressively for a typing-style effect.
// ------------------------------------------------------------
function parseExplanationToBlocks(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];

  let i = 0;
  let listBuffer = [];

  function flushList() {
    if (listBuffer.length) {
      const items = listBuffer.map((item) => `<li>${renderInline(item)}</li>`).join("");
      blocks.push(`<ul>${items}</ul>`);
      listBuffer = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Heading (## Heading)
    if (/^#{1,3}\s+/.test(trimmed)) {
      flushList();
      const text = trimmed.replace(/^#{1,3}\s+/, "");
      blocks.push(`<h3>${renderInline(text)}</h3>`);
      i++;
      continue;
    }

    // Code fence (```lang ... ```)
    if (trimmed.startsWith("```")) {
      flushList();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // Bullet list item
    if (/^[-*]\s+/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^[-*]\s+/, ""));
      i++;
      continue;
    }

    // Blank line
    if (trimmed === "") {
      flushList();
      i++;
      continue;
    }

    // Regular paragraph line
    flushList();
    blocks.push(`<p>${renderInline(trimmed)}</p>`);
    i++;
  }

  flushList();
  return blocks;
}

// ------------------------------------------------------------
// CORE: Reveal parsed blocks progressively (typing-style effect)
// ------------------------------------------------------------
function revealBlocks(blocks) {
  return new Promise((resolve) => {
    explanationOutput.innerHTML = "";
    let index = 0;

    function revealNext() {
      if (index >= blocks.length) {
        resolve();
        return;
      }
      const wrapper = document.createElement("div");
      wrapper.innerHTML = blocks[index];
      wrapper.style.animation = "fadeInUp 0.35s ease both";
      explanationOutput.appendChild(wrapper.firstElementChild || wrapper);
      index++;
      setTimeout(revealNext, 90);
    }

    revealNext();
  });
}

// ------------------------------------------------------------
// CORE: Call the Groq API and return the raw explanation text
// ------------------------------------------------------------
async function fetchExplanation(prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1800
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw new Error("No internet connection. Please check your network and try again.");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid API key. Please check your Groq API key and try again.");
    }
    if (response.status === 429) {
      throw new Error("Rate limit reached. Please wait a moment and try again.");
    }
    if (response.status >= 500) {
      throw new Error("The AI server is having issues right now. Please try again shortly.");
    }
    throw new Error(`Something went wrong (error ${response.status}). Please try again.`);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("Received an unreadable response from the server. Please try again.");
  }

  const explanation = data?.choices?.[0]?.message?.content?.trim();
  if (!explanation) {
    throw new Error("The AI didn't return an explanation. Please try again.");
  }

  return explanation;
}

// ------------------------------------------------------------
// CORE: Handle the "Explain Code" action
// ------------------------------------------------------------
async function handleExplain() {
  const code = codeInput.value.trim();

  // ---- Validation ----
  if (!code) {
    showToast("Please paste some code.", "error");
    codeInput.focus();
    return;
  }

  const language = languageSelect.value;
  const explanationType = explanationTypeSelect.value;
  const prompt = buildPrompt(language, explanationType, code);

  setLoading(true);
  resultSection.hidden = true;

  try {
    const explanation = await fetchExplanation(prompt);
    lastRawExplanation = explanation;

    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const blocks = parseExplanationToBlocks(explanation);
    await revealBlocks(blocks);

    showToast("Code explained successfully!", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

// ------------------------------------------------------------
// CORE: Clear the form
// ------------------------------------------------------------
function handleClear() {
  codeInput.value = "";
  autoResizeTextarea();
  updateCodeStats();
  resultSection.hidden = true;
  explanationOutput.innerHTML = "";
  lastRawExplanation = "";
  codeInput.focus();
}

// ------------------------------------------------------------
// CORE: Copy explanation to clipboard
// ------------------------------------------------------------
async function handleCopy() {
  if (!lastRawExplanation) return;
  try {
    await navigator.clipboard.writeText(lastRawExplanation);
    showToast("Explanation copied to clipboard!", "success");
  } catch (error) {
    showToast("Couldn't copy automatically. Please copy manually.", "error");
  }
}

// ------------------------------------------------------------
// CORE: Download explanation as a .txt file
// ------------------------------------------------------------
function handleDownloadTxt() {
  if (!lastRawExplanation) return;

  const blob = new Blob([lastRawExplanation], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "code-explanation.txt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
  showToast("Explanation downloaded as TXT!", "success");
}

// ------------------------------------------------------------
// CORE: Download explanation as a .pdf file
// ------------------------------------------------------------
function handleDownloadPdf() {
  if (!lastRawExplanation) return;

  if (!window.jspdf) {
    showToast("PDF library failed to load. Please check your connection.", "error");
    return;
  }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const margin = 48;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxLineWidth = pageWidth - margin * 2;

    doc.setFont("courier", "normal");
    doc.setFontSize(10);

    const lines = doc.splitTextToSize(lastRawExplanation, maxLineWidth);
    let cursorY = margin;
    const lineHeight = 14;

    lines.forEach((line) => {
      if (cursorY > pageHeight - margin) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(line, margin, cursorY);
      cursorY += lineHeight;
    });

    doc.save("code-explanation.pdf");
    showToast("Explanation downloaded as PDF!", "success");
  } catch (error) {
    showToast("Couldn't create the PDF. Please try again.", "error");
  }
}

// ------------------------------------------------------------
// CORE: Explain again using the same code + settings
// ------------------------------------------------------------
function handleExplainAgain() {
  handleExplain();
}

// ------------------------------------------------------------
// EVENT LISTENERS
// ------------------------------------------------------------
codeInput.addEventListener("input", () => {
  autoResizeTextarea();
  updateCodeStats();
});

explainBtn.addEventListener("click", handleExplain);
clearBtn.addEventListener("click", handleClear);
copyBtn.addEventListener("click", handleCopy);
downloadTxtBtn.addEventListener("click", handleDownloadTxt);
downloadPdfBtn.addEventListener("click", handleDownloadPdf);
explainAgainBtn.addEventListener("click", handleExplainAgain);

// Keyboard shortcut: Ctrl/Cmd + Enter to explain
document.addEventListener("keydown", (event) => {
  const isCtrlEnter = (event.ctrlKey || event.metaKey) && event.key === "Enter";
  if (isCtrlEnter) {
    event.preventDefault();
    handleExplain();
  }
});

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
updateCodeStats();
