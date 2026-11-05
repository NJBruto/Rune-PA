/* Small, dependency-free Markdown renderer.
 * Input is escaped first, so dangerouslySetInnerHTML is safe here. */

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[character]));
}

export function renderMarkdown(value) {
    let html = escapeHtml(value);

    html = html.replace(
        /```([^\n`]*)\n([\s\S]*?)```/g,
        (match, language, code) =>
            "<pre class=\"code\"><code>" +
            code.replace(/\n$/, "") +
            "</code></pre>"
    );

    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    html = html.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        "<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>"
    );
    html = html.replace(/^### (.+)$/gm, "<span class=\"md-h3\">$1</span>");
    html = html.replace(/^## (.+)$/gm, "<span class=\"md-h2\">$1</span>");

    return html;
}
