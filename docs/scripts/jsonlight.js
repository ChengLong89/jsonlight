let long_demo = {
    "string": "This is a string value\nThis the second line",
    "number": 123.456,
    "list": ["elem1", "elem2", "elem3", "elem4", "elem5", "elem6",
             "elem7", "elem8", "elem9", "elem10", "elem11", "elem12",
             "elem13", "elem14", "elem15", "elem16", "elem17", "elem18"],
    "boolean": true,
    "null": null
};

let demo = {
    "string": "This is a string value\nThis the second line\n" +
              "Test HTML tags: <span> content </span>\n",
    "number": 123.456,
    "list": ["elem1", "elem2"],
    "boolean": true,
    "null": null,
    "long-demo": long_demo,
    "empty-list": [],
    "empty-object": {},
    "long-string": "Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long Very Long "
};

let welcome = {
    "title": "JSON Light",
    "description": "A JSON viewer that displays multi-line strings in its raw format!",
    "tip": "Click the R (view raw) button in the following line",
    "banner": "\n       _  _____  ____  _   _   _      _       _     _   \n      | |/ ____|/ __ \\| \\ | | | |    (_)     | |   | |  \n      | | (___ | |  | |  \\| | | |     _  __ _| |__ | |_ \n  _   | |\\___ \\| |  | | . ` | | |    | |/ _` | '_ \\| __|\n | |__| |____) | |__| | |\\  | | |____| | (_| | | | | |_ \n  \\____/|_____/ \\____/|_| \\_| |______|_|\\__, |_| |_|\\__|\n                                         __/ |          \n                                        |___/           \n",
    "embedded-json": "{\"tip\": \"Strings containing JSON can be expanded with the + button\", \"nested\": [1, 2, 3]}"
}

/*************************************
 *              Renderer             *
 *************************************/

// JSON key-value pair -> HTML element
// for a key-value pair in an object, key is a string.
// for elements in a list, key is a number "index".
// for the root-level value, key is null.
function renderKV(key, loader) {
    let kvRoot = newKV(loader);
    let kvText = kvRoot.querySelector(".kv .kv-text");
    kvText.appendChild(renderKey(key));

    let colonSpan = document.createElement("span");
    colonSpan.innerText = ": ";
    kvText.appendChild(colonSpan);

    value = loader.getValue();
    let valueSpan = null;
    switch (typeof value) {
        case "string":
            valueSpan = renderString(kvRoot, value);
            break;
        case "number":
            valueSpan = renderNumber(kvRoot, value);
            break;
        case "boolean":
            valueSpan = renderBool(kvRoot, value);
            break;
        case "object":
            if (value == null) {
                valueSpan = renderNull(kvRoot, value);
            }
            else if (Array.isArray(value)) {
                valueSpan = renderArray(kvRoot, value);
            }
            else {
                valueSpan = renderObject(kvRoot, value);
            }
    }
    kvText.appendChild(valueSpan);
    return kvRoot;
}

function newKV(loader) {
    let kvRoot = document.createElement("div");
    kvRoot.loader = loader;
    kvRoot.classList.add("kv-root");
    let kv = document.createElement("div");
    kv.classList.add("kv", "d-flex", "align-items-center", "mb-1");
    let kvText = document.createElement("div");
    kvText.classList.add("kv-text");
    kv.appendChild(kvText);
    kvRoot.appendChild(kv);
    return kvRoot;
}

function newToggleButton(text) {
    let toggleButton = document.createElement("button");
    toggleButton.classList.add("btn", "btn-light", "btn-sm");
    toggleButton.setAttribute("data-bs-toggle", "button");
    toggleButton.setAttribute("type", "button");
    toggleButton.innerHTML = text;
    return toggleButton;
}

// Adds a collapse button and a collapsed child list to kvRoot.
// The child list is initially empty,
// When the button is hit, the child list is rendered from childLoader
// (defaults to kvRoot.loader).
function addCollapse(kvRoot, dataRef, childLoader = kvRoot.loader) {
    kvRoot.dataRef = dataRef

    let kv = kvRoot.querySelector(".kv");
    
    let collapseButton = newToggleButton("+");
    collapseButton.classList.add("toggle-button", "collapse-button");
    kv.insertBefore(collapseButton, kv.firstChild);
    
    let collapseWrapper = document.createElement("div");
    collapseWrapper.classList.add("collapse");
    let childBlock = document.createElement("div");
    childBlock.classList.add("child-block", "d-flex", "gap-2");
    let indent = document.createElement("div");
    indent.classList.add("indent", "border-end", "pe-5", "flex-shrink-0");
    let childList = document.createElement("div");
    childList.classList.add("child-list");
    childBlock.appendChild(indent);
    childBlock.appendChild(childList);
    collapseWrapper.appendChild(childBlock);
    kvRoot.appendChild(collapseWrapper);
    
    collapseButton.addEventListener("click", (ev) => {
        if (!collapseWrapper.classList.contains("collapsing")) {
            new bootstrap.Collapse(collapseWrapper);
        }
    });

    collapseWrapper.addEventListener('show.bs.collapse', (ev) => {
        ev.stopPropagation();
        // Loaders that parse lazily (embedded JSON strings) report errors here
        let error = childLoader.prepare?.();
        if (error) {
            childList.appendChild(renderNotice(error));
        } else {
            appendChildPage(childList, childLoader, 0, CHILD_PAGE_SIZE);
        }
        collapseButton.innerHTML = "-";
    });
    collapseWrapper.addEventListener('hidden.bs.collapse', (ev) => {
        ev.stopPropagation();
        childList.renderGeneration = (childList.renderGeneration || 0) + 1; // stops "Show all"
        childList.replaceChildren();
        collapseButton.innerHTML = "+";
    })
}

// Children are rendered a page at a time so that expanding a huge
// array/object does not create millions of DOM nodes at once.
const CHILD_PAGE_SIZE = 100;
const SHOW_ALL_CHUNK_SIZE = 500; // rendered per animation frame by "Show all"

// Renders children [start, start + count) of loader into childList, followed
// by a "show more" row if children remain.
function appendChildPage(childList, loader, start, count) {
    let total = loader.getChildCount();
    let end = Math.min(start + count, total);
    let fragment = document.createDocumentFragment();
    for (const childKV of loader.getChildRange(start, end)) {
        fragment.appendChild(renderKV(...childKV));
    }
    childList.appendChild(fragment);
    if (end < total) {
        childList.appendChild(renderMoreRow(childList, loader, end, total));
    }
}

function renderMoreRow(childList, loader, next, total) {
    let row = document.createElement("div");
    row.classList.add("more-row", "mb-1", "small", "text-muted");

    let remaining = total - next;
    let info = document.createElement("span");
    info.textContent = `Showing ${next.toLocaleString()} of ${total.toLocaleString()} · `;
    row.appendChild(info);

    let moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.classList.add("btn", "btn-link", "btn-sm", "p-0", "align-baseline");
    moreButton.textContent = `Show ${Math.min(CHILD_PAGE_SIZE, remaining).toLocaleString()} more`;
    moreButton.addEventListener("click", () => {
        row.remove();
        appendChildPage(childList, loader, next, CHILD_PAGE_SIZE);
    });
    row.appendChild(moreButton);

    if (remaining > CHILD_PAGE_SIZE) {
        row.appendChild(document.createTextNode(" · "));
        let allButton = document.createElement("button");
        allButton.type = "button";
        allButton.classList.add("btn", "btn-link", "btn-sm", "p-0", "align-baseline");
        allButton.textContent = `Show all (${remaining.toLocaleString()} more)`;
        allButton.addEventListener("click", () => {
            row.remove();
            appendAllChildren(childList, loader, next, total);
        });
        row.appendChild(allButton);
    }
    return row;
}

// Renders the remaining children in chunks, yielding to the browser between
// chunks so the page stays responsive. Stops if the parent is collapsed or
// the document is replaced (e.g. another file is opened).
async function appendAllChildren(childList, loader, start, total) {
    let generation = childList.renderGeneration;
    let progress = renderNotice("");
    for (let i = start; i < total; i += SHOW_ALL_CHUNK_SIZE) {
        if (childList.renderGeneration !== generation || !childList.isConnected) return;
        progress.remove();
        let end = Math.min(i + SHOW_ALL_CHUNK_SIZE, total);
        let fragment = document.createDocumentFragment();
        for (const childKV of loader.getChildRange(i, end)) {
            fragment.appendChild(renderKV(...childKV));
        }
        childList.appendChild(fragment);
        if (end < total) {
            progress.textContent = `Rendering… ${end.toLocaleString()} of ${total.toLocaleString()}`;
            childList.appendChild(progress);
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)));
        }
    }
}

function renderNotice(text) {
    let notice = document.createElement("div");
    notice.classList.add("notice", "mb-1", "small", "text-muted");
    notice.textContent = text;
    return notice;
}

// for a key-value pair in an object, key is a string.
// for elements in a list, key is a number "index".
// for the root-level value, key is null.
function renderKey(key) {
    let keystr = "key error";
    if (key == null) keystr = "root";
    else if (typeof(key) == "number") {
        keystr = "[" + key.toString() + "]";
    }
    else if (typeof(key) == "string") {
        keystr = JSON.stringify(key);
    }
    let keySpan = document.createElement("span");
    keySpan.classList.add("text-primary");
    keySpan.innerText = keystr;
    return keySpan;
}

function addViewRaw(kvRoot) {
    let viewRawButton = newToggleButton("R");
    viewRawButton.classList.add("toggle-button", "view-raw-button");
    viewRawButton.addEventListener("click", (ev) => {
        if (viewRawButton.classList.contains("active")) {
            renderRawString(kvRoot);
        }
        else {
            cancelRawString(kvRoot);
        }
    });
    
    let kv = kvRoot.querySelector(".kv");
    kv.insertBefore(viewRawButton, kv.firstChild);
}

function renderRawString(kvRoot) {
    let jsonValue = kvRoot.querySelector(".kv .kv-text .json-value");
    jsonValue.style.display = "none";

    let rawString = document.createElement("pre");
    rawString.classList.add("raw-string", "mb-1");

    // The last trailing new line is not rendered by the browser.
    // Fix it by appending an extra newline character.
    rawString.textContent = kvRoot.loader.getValue() + "\n";
    kvRoot.appendChild(rawString);
}

function cancelRawString(kvRoot) {
    let rawString = kvRoot.querySelector(":scope > .raw-string");
    kvRoot.removeChild(rawString);
    let jsonValue = kvRoot.querySelector(".kv .kv-text .json-value");
    jsonValue.style.display = ""; // let stylesheet rules (e.g. embedded-json-expanded) apply
}

function renderStringify(jobj) {
    let valueSpan = document.createElement("span");
    valueSpan.classList.add("json-value");
    valueSpan.textContent = JSON.stringify(jobj);
    return valueSpan;
}

function renderString(kvRoot, jobj) {
    addViewRaw(kvRoot);
    let valueSpan = renderStringify(jobj);

    // A string holding a non-empty JSON object/array can be expanded like one
    let childLoader = embeddedJsonLoader(jobj);
    if (childLoader) {
        addCollapse(kvRoot, null, childLoader);

        // Hide the original string while expanded
        let collapseWrapper = kvRoot.querySelector(":scope > .collapse");
        collapseWrapper.addEventListener("show.bs.collapse", (ev) => {
            if (ev.target == collapseWrapper) kvRoot.classList.add("embedded-json-expanded");
        });
        collapseWrapper.addEventListener("hide.bs.collapse", (ev) => {
            if (ev.target == collapseWrapper) kvRoot.classList.remove("embedded-json-expanded");
        });

        let badge = document.createElement("span");
        badge.classList.add("badge", "text-bg-secondary", "ms-2", "embedded-json-badge");
        badge.textContent = "JSON";
        let wrapper = document.createElement("span");
        wrapper.append(valueSpan, badge);
        return wrapper;
    }
    return valueSpan;
}

// Strings up to this length are parsed when rendered, so only valid JSON gets
// a + button. Longer ones are only checked for {...} / [...] and parsed when
// expanded, to avoid parsing big strings that are never opened.
const EAGER_PARSE_LIMIT = 64 * 1024;

// Returns a loader for the JSON embedded in str, or null if str does not
// hold a (non-empty) JSON object or array.
function embeddedJsonLoader(str) {
    if (!looksLikeJsonContainer(str)) return null;
    if (str.length > EAGER_PARSE_LIMIT) return new EmbeddedJsonLoader(str);

    let value = parseEmbeddedJson(str);
    if (value === undefined) return null;
    let loader = new WebDataLoader();
    loader.loadObject(value);
    return loader;
}

// True if str, ignoring surrounding whitespace, starts and ends with {} or [].
// Does not copy str (no trim), so it is cheap for huge strings.
function looksLikeJsonContainer(str) {
    let i = 0, j = str.length - 1;
    while (i <= j && /\s/.test(str[i])) i++;
    while (j >= i && /\s/.test(str[j])) j--;
    if (i >= j) return false;
    return (str[i] == "{" && str[j] == "}") || (str[i] == "[" && str[j] == "]");
}

// Returns the parsed value if str is a non-empty JSON object or array,
// otherwise undefined.
function parseEmbeddedJson(str) {
    let value;
    try {
        value = JSON.parse(str);
    } catch (exception) {
        return undefined;
    }
    if (value == null || typeof value != "object") return undefined;
    if (Array.isArray(value) ? value.length == 0 : Object.keys(value).length == 0) {
        return undefined;
    }
    return value;
}

function renderNumber(kvRoot, jobj) {
    return renderStringify(jobj);
}

function renderBool(kvRoot, jobj) {
    return renderStringify(jobj);
}

function renderNull(kvRoot, jobj) {
    return renderStringify(jobj);
}

function renderArray(kvRoot, jobj) {
    let valueSpan = document.createElement("span");
    valueSpan.classList.add("json-value");
    if (jobj.length == 0) {
        valueSpan.textContent = "[]";
        return valueSpan;
    }
    addCollapse(kvRoot, jobj);
    valueSpan.textContent = "[...]";
    return valueSpan;
}

function renderObject(kvRoot, jobj) {
    let valueSpan = document.createElement("span");
    valueSpan.classList.add("json-value");
    if (Object.keys(jobj).length == 0) {
        valueSpan.textContent = "{}"
        return valueSpan;
    }
    addCollapse(kvRoot, jobj);
    valueSpan.textContent = "{...}"
    return valueSpan;
}

/*************************************
 *           Data Loader             *
 *************************************/

// base class for dataloaders
// A dataloader corresponds to an array or an object,
// and is responsible to load its children.
class DataLoader {
    constructor() {
        this.value = undefined;
    }

    loadString() {}
    async loadFile() {}
    loadObject(obj) {
        this.value = obj;
    }
    getValue() {
        return this.value;
    }

    getChildCount() {
        let v = this.value;
        if (v == null || typeof v != "object") return 0;
        if (Array.isArray(v)) return v.length;
        return this.objectKeys().length;
    }

    // Returns a list of (key, dataloader) for children [start, end).
    // Only the requested range is materialized, so huge arrays/objects stay cheap.
    getChildRange(start, end) {
        let v = this.value;
        end = Math.min(end, this.getChildCount());
        let isArray = Array.isArray(v);
        let keys = isArray ? null : this.objectKeys();
        let ret = [];
        for (let i = start; i < end; i++) {
            let key = isArray ? i : keys[i];
            let childLoader = new WebDataLoader();
            childLoader.loadObject(v[key]);
            ret.push([key, childLoader]);
        }
        return ret;
    }

    // Object.keys(value), cached per value
    objectKeys() {
        if (this.keysOf !== this.value) {
            this.keys = Object.keys(this.value);
            this.keysOf = this.value;
        }
        return this.keys;
    }
}

// Browsers cannot hold strings longer than ~512 Mi characters (V8's limit),
// so a bigger JSON file cannot be read as text and parsed in one piece.
// Blob.text() does not throw for such files: it returns "".
const MAX_STRING_LENGTH = 536870888;
// A UTF-8 file has at least one byte per 3 UTF-16 characters, so anything
// larger than this is certainly too big and is rejected without reading it.
const MAX_TEXT_FILE_SIZE = 3 * MAX_STRING_LENGTH;

// Reads file as text, or returns null if it is too large for a string
async function readFileText(file) {
    if (file.size > MAX_TEXT_FILE_SIZE) return null;
    let text = await file.text();
    if (text.length == 0 && file.size > 0) return null;
    return text;
}

function fileTooLargeError(file) {
    return {
        success: false,
        error: `File is too large to open in JSON mode (${formatBytes(file.size)}). ` +
               `Browsers cannot hold text over ~512 MB. ` +
               `If it is a JSON Lines file, open it in JSONL mode.`,
        type: 'File Too Large'
    };
}

function formatBytes(n) {
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + " GB";
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
}

function hasExtension(file, ...exts) {
    let name = file.name.toLowerCase();
    return exts.some(ext => name.endsWith(ext));
}


class WebDataLoader extends DataLoader {
    constructor() {
        super();
    }

    loadString(jsonStr) {
        try {
            this.value = JSON.parse(jsonStr);
            return { success: true };
        }
        catch (exception) {
            return {
                success: false,
                error: exception.message,
                type: 'JSON Parse Error'
            };
        }
    }

    async loadFile(file) {
        if (!hasExtension(file, ".json", ".geojson", ".jsonl")) {
            return {
                success: false,
                error: `Unsupported file type: ${file.name}`,
                type: 'File Type Error'
            };
        }
        let fileText;
        try {
            fileText = await readFileText(file);
        }
        catch (exception) {
            return { success: false, error: exception.message, type: 'File Read Error' };
        }
        if (fileText === null) return fileTooLargeError(file);

        if (!hasExtension(file, ".jsonl")) return this.loadString(fileText);

        try {
            let lines = fileText.split(/[\r\n]+/);
            this.value = lines.filter(line => line).map((line, index) => {
                try {
                    return JSON.parse(line);
                } catch (exception) {
                    throw new Error(`Line ${index + 1}: ${exception.message}`);
                }
            });
            return { success: true };
        }
        catch (exception) {
            return {
                success: false,
                error: exception.message,
                type: 'JSONL Parse Error'
            };
        }
    }
}

// Loader for a long embedded-JSON string, parsed on first expansion.
class EmbeddedJsonLoader extends WebDataLoader {
    constructor(str) {
        super();
        this.source = str;
    }

    // Returns an error message to show instead of children, or null.
    prepare() {
        if (this.source === null) return this.error;
        this.error = this.loadString(this.source).success ? null : "Not valid JSON";
        if (!this.error && this.getChildCount() == 0) {
            this.error = "Empty JSON " + (Array.isArray(this.value) ? "array" : "object");
        }
        this.source = null;
        return this.error;
    }
}

// Reads a JSON Lines file without loading it as one string: the file is
// scanned once to record the byte range of every non-blank line, and each
// line is read from the file only when it is shown.
class JsonlDataLoader extends DataLoader {
    static CHUNK_SIZE = 16 * 1024 * 1024;

    constructor() {
        super();
        this.file = null;
        this.lineStarts = new Float64Array(1024);
        this.lineEnds = new Float64Array(1024);
        this.lineCount = 0;
        this.currentLine = 0;
    }

    // onProgress(fraction) is called while the line index is built
    async loadFile(file, onProgress = () => {}) {
        if (!hasExtension(file, ".jsonl", ".json", ".geojson")) {
            return {
                success: false,
                error: `Expected .json .jsonl .geojson file, got: ${file.name}`,
                type: 'File Type Error'
            };
        }

        try {
            this.file = file;
            await this.buildLineIndex(onProgress);
            if (this.lineCount === 0) {
                return {
                    success: false,
                    error: 'File is empty or contains no valid lines',
                    type: 'JSONL File Error'
                };
            }
            return await this.loadLine(0);
        }
        catch (exception) {
            return {
                success: false,
                error: exception.message,
                type: 'File Read Error'
            };
        }
    }

    async buildLineIndex(onProgress) {
        const NEWLINE = 10;
        let size = this.file.size;
        let lineStart = 0;
        let lineHasContent = false; // blank / whitespace-only lines are skipped

        for (let offset = 0; offset < size; offset += JsonlDataLoader.CHUNK_SIZE) {
            let chunkEnd = Math.min(offset + JsonlDataLoader.CHUNK_SIZE, size);
            let bytes = new Uint8Array(await this.file.slice(offset, chunkEnd).arrayBuffer());
            let pos = 0;
            while (true) {
                let nl = bytes.indexOf(NEWLINE, pos);
                let segEnd = nl == -1 ? bytes.length : nl;
                if (!lineHasContent) {
                    for (let i = pos; i < segEnd; i++) {
                        let b = bytes[i];
                        if (b != 32 && b != 9 && b != 13) { lineHasContent = true; break; }
                    }
                }
                if (nl == -1) break;
                if (lineHasContent) this.addLine(lineStart, offset + nl);
                lineStart = offset + nl + 1;
                lineHasContent = false;
                pos = nl + 1;
            }
            onProgress(chunkEnd / size);
        }
        if (lineHasContent) this.addLine(lineStart, size);
    }

    addLine(start, end) {
        if (this.lineCount == this.lineStarts.length) {
            let starts = new Float64Array(this.lineStarts.length * 2);
            let ends = new Float64Array(this.lineEnds.length * 2);
            starts.set(this.lineStarts);
            ends.set(this.lineEnds);
            this.lineStarts = starts;
            this.lineEnds = ends;
        }
        this.lineStarts[this.lineCount] = start;
        this.lineEnds[this.lineCount] = end;
        this.lineCount++;
    }

    async loadLine(lineIndex) {
        if (lineIndex < 0 || lineIndex >= this.lineCount) {
            return {
                success: false,
                error: `Line ${lineIndex + 1} is out of range (1-${this.lineCount})`,
                type: 'Line Index Error'
            };
        }

        try {
            // A trailing \r is JSON whitespace, so CRLF files parse as-is
            let line = await this.file.slice(this.lineStarts[lineIndex], this.lineEnds[lineIndex]).text();
            this.value = JSON.parse(line);
            this.currentLine = lineIndex;
            return { success: true };
        }
        catch (exception) {
            return {
                success: false,
                error: `Line ${lineIndex + 1}: ${exception.message}`,
                type: 'JSON Parse Error'
            };
        }
    }

    getTotalLines() {
        return this.lineCount;
    }

    getCurrentLine() {
        return this.currentLine;
    }
}

class DesktopDataLoader extends DataLoader {

}


/*************************************
 *           File Name Display       *
 *************************************/

function updateFileNameDisplay(fileName) {
    const fileNameElement = document.querySelector("#file-name-display");
    if (fileName) {
        fileNameElement.textContent = fileName;
        fileNameElement.title = fileName; // Show full name on hover
        fileNameElement.style.display = "block";
    } else {
        fileNameElement.textContent = "No file selected";
        fileNameElement.title = "";
        fileNameElement.style.display = "none";
    }
}

function clearFileNameDisplay() {
    updateFileNameDisplay(null);
}

/*************************************
 *           Controls                *
 *************************************/

let g_platform = "web";
let g_jsonlLoader = null; // Global JSONL loader for line navigation

function newDataLoader() {
    if (g_platform == "web") {
        return new WebDataLoader();
    }
    else {
        return new DesktopDataLoader();
    }
}

function renderJSON(loader) {
    setExpandStatus("");
    let rootJson = renderKV(null, loader);
    document.querySelector("#view").appendChild(rootJson);
    let rootButton = rootJson.querySelector(".collapse-button");
    if (rootButton) {
        rootButton.style.display = "none";
        rootButton.click();
    }
}

function displayParseError(errorInfo) {
    let errorContainer = document.createElement("div");
    errorContainer.classList.add("alert", "alert-danger", "m-3");
    
    let errorTitle = document.createElement("h5");
    errorTitle.classList.add("alert-heading");
    errorTitle.innerText = errorInfo?.type || "Error";
    errorContainer.appendChild(errorTitle);
    
    let errorMessage = document.createElement("p");
    errorMessage.classList.add("mb-0");
    errorMessage.innerText = errorInfo?.error || "An unknown error occurred";
    errorContainer.appendChild(errorMessage);
    
    document.querySelector("#view").appendChild(errorContainer);
}

function renderJsonStr(jsonStr) {
    ++g_renderToken;
    document.querySelector("#view").replaceChildren();

    let loader = newDataLoader();
    let result = loader.loadString(jsonStr);
    if (!result.success) {
        displayParseError(result);
        return;
    }
    renderJSON(loader);
}

// Incremented by every new render request; an async load whose token is
// stale when it finishes has been superseded and must not render.
let g_renderToken = 0;

function showLoading(text) {
    document.querySelector("#view").replaceChildren(renderNotice(text));
}

// Lets the browser paint (e.g. a loading message) before blocking work
function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)));
}

async function renderJsonFile(file) {
    let token = ++g_renderToken;
    showLoading(`Loading ${file.name} (${formatBytes(file.size)})…`);
    await nextFrame();

    let loader = newDataLoader();
    let result = await loader.loadFile(file);
    if (token !== g_renderToken) return;
    document.querySelector("#view").replaceChildren();
    if (!result.success) {
        displayParseError(result);
        return;
    }
    renderJSON(loader);
}

async function renderJsonlFile(file) {
    let token = ++g_renderToken;
    showLoading(`Indexing lines of ${file.name} (${formatBytes(file.size)})…`);

    let jsonlLoader = new JsonlDataLoader();
    g_jsonlLoader = jsonlLoader;
    let result = await jsonlLoader.loadFile(file, (fraction) => {
        if (token === g_renderToken) {
            showLoading(`Indexing lines of ${file.name}… ${Math.floor(fraction * 100)}%`);
        }
    });
    if (token !== g_renderToken) return;
    document.querySelector("#view").replaceChildren();
    if (!result.success) {
        displayParseError(result);
        return;
    }
    
    // Show JSONL controls
    showJsonlControls();
    updateJsonlControls();
    renderCurrentJsonlLine();
}

function showJsonlControls() {
    document.querySelector("#jsonl-controls").style.display = "block";
}

function hideJsonlControls() {
    document.querySelector("#jsonl-controls").style.display = "none";
    g_jsonlLoader = null;
}

function updateJsonlControls() {
    if (!g_jsonlLoader) return;
    
    const totalLines = g_jsonlLoader.getTotalLines();
    const currentLine = g_jsonlLoader.getCurrentLine() + 1; // 1-indexed for display
    
    document.querySelector("#total-lines").textContent = `/ ${totalLines}`;
    document.querySelector("#line-input").value = currentLine;
    document.querySelector("#line-input").max = totalLines;
    
    // Update button states
    document.querySelector("#prev-line").disabled = currentLine <= 1;
    document.querySelector("#next-line").disabled = currentLine >= totalLines;
}

function renderCurrentJsonlLine() {
    if (!g_jsonlLoader) return;
    
    document.querySelector("#view").replaceChildren();
    
    // Create a temporary loader with the current line's data
    let loader = new WebDataLoader();
    loader.loadObject(g_jsonlLoader.getValue());
    renderJSON(loader);
}

async function navigateToLine(lineNumber) {
    if (!g_jsonlLoader) return;

    const lineIndex = lineNumber - 1; // Convert to 0-indexed
    let token = ++g_renderToken;
    let result = await g_jsonlLoader.loadLine(lineIndex);
    if (token !== g_renderToken) return; // a newer navigation or file load won
    if (result.success) {
        updateJsonlControls();
        renderCurrentJsonlLine();
    } else {
        // Display error in a temporary alert
        let errorAlert = document.createElement("div");
        errorAlert.classList.add("alert", "alert-warning", "alert-dismissible", "fade", "show", "m-2");
        errorAlert.innerHTML = `
            <strong>Navigation Error:</strong> ${result.error}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector("#view").insertBefore(errorAlert, document.querySelector("#view").firstChild);
        
        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            if (errorAlert.parentNode) {
                errorAlert.parentNode.removeChild(errorAlert);
            }
        }, 3000);
        
        // Reset input to current line
        updateJsonlControls();
    }
}

let pasteArea = document.querySelector("#paste");
pasteArea.addEventListener("change", (ev) => {
    hideJsonlControls(); // Hide JSONL controls when using paste
    clearFileNameDisplay(); // Clear file name when using paste
    renderJsonStr(pasteArea.value);
});
if (pasteArea.value != "") {
    renderJsonStr(pasteArea.value);
}

let filePicker = document.querySelector("#filepicker");
filePicker.addEventListener("change", (ev) => {
    hideJsonlControls(); // Hide JSONL controls when using regular file picker
    if (filePicker.files[0]) {
        updateFileNameDisplay(filePicker.files[0].name);
        renderJsonFile(filePicker.files[0]);
    } else {
        clearFileNameDisplay();
    }
})

let jsonlPicker = document.querySelector("#jsonlpicker");
jsonlPicker.addEventListener("change", (ev) => {
    if (jsonlPicker.files[0]) {
        updateFileNameDisplay(jsonlPicker.files[0].name);
        renderJsonlFile(jsonlPicker.files[0]);
    } else {
        clearFileNameDisplay();
    }
})

// JSONL navigation controls
let prevButton = document.querySelector("#prev-line");
prevButton.addEventListener("click", (ev) => {
    if (g_jsonlLoader) {
        const currentLine = g_jsonlLoader.getCurrentLine() + 1;
        if (currentLine > 1) {
            navigateToLine(currentLine - 1);
        }
    }
});

let nextButton = document.querySelector("#next-line");
nextButton.addEventListener("click", (ev) => {
    if (g_jsonlLoader) {
        const currentLine = g_jsonlLoader.getCurrentLine() + 1;
        const totalLines = g_jsonlLoader.getTotalLines();
        if (currentLine < totalLines) {
            navigateToLine(currentLine + 1);
        }
    }
});

let lineInput = document.querySelector("#line-input");
lineInput.addEventListener("change", (ev) => {
    if (g_jsonlLoader) {
        const lineNumber = parseInt(lineInput.value);
        const totalLines = g_jsonlLoader.getTotalLines();
        if (lineNumber >= 1 && lineNumber <= totalLines) {
            navigateToLine(lineNumber);
        } else {
            // Reset to current line if invalid input
            updateJsonlControls();
        }
    }
});

lineInput.addEventListener("keypress", (ev) => {
    if (ev.key === "Enter") {
        ev.target.blur(); // Trigger change event
    }
});

// Expand All / Collapse All functionality
let expandAllButton = document.querySelector("#expand-all");
expandAllButton.addEventListener("click", async (ev) => {
    await expandAll();
});

let collapseAllButton = document.querySelector("#collapse-all");
collapseAllButton.addEventListener("click", (ev) => {
    collapseAll();
});

// Expand All stops once this many items are rendered, so a large document
// does not freeze the page. Each node only renders its first page of children.
const EXPAND_ALL_LIMIT = 2000;

async function expandAll() {
    let foundCollapsed = true;
    let renderedItems = document.querySelector("#view").getElementsByClassName("kv-root");
    let limitReached = false;
    setExpandStatus("");

    // Keep expanding until no more collapsed items are found
    while (foundCollapsed && !limitReached) {
        foundCollapsed = false;
        const collapseButtons = document.querySelectorAll(".collapse-button");

        // Create an array of promises for all the expansions in this level
        const expansionPromises = [];

        collapseButtons.forEach(button => {
            const kvRoot = button.closest(".kv-root");
            const collapseWrapper = kvRoot.querySelector(".collapse");

            // Only expand if it's currently collapsed
            if (!collapseWrapper.classList.contains("show") && !limitReached) {
                if (renderedItems.length >= EXPAND_ALL_LIMIT) {
                    limitReached = true;
                    return;
                }
                foundCollapsed = true;
                
                // Create a promise that resolves when the collapse is fully shown
                const expansionPromise = new Promise((resolve) => {
                    const onShown = () => {
                        collapseWrapper.removeEventListener('shown.bs.collapse', onShown);
                        resolve();
                    };
                    collapseWrapper.addEventListener('shown.bs.collapse', onShown);
                    button.click();
                });
                
                expansionPromises.push(expansionPromise);
            }
        });
        
        // Wait for all expansions in this level to complete before moving to the next level
        if (expansionPromises.length > 0) {
            await Promise.all(expansionPromises);
        }
    }

    if (limitReached) {
        setExpandStatus(`Stopped after ${EXPAND_ALL_LIMIT.toLocaleString()} items to keep the page responsive. ` +
                        `Expand the rest by hand.`);
    }
}

function setExpandStatus(text) {
    document.querySelector("#expand-status").textContent = text;
}

function collapseAll() {
    setExpandStatus("");
    const collapseButtons = document.querySelectorAll(".collapse-button");
    collapseButtons.forEach(button => {
        const kvRoot = button.closest(".kv-root");
        const collapseWrapper = kvRoot.querySelector(".collapse");
        
        // Skip the root level collapse button (it should stay expanded)
        // The root level button has display: none style applied
        const isRootLevel = button.style.display === "none";
        
        // Only collapse if it's currently expanded and not the root level
        if (collapseWrapper.classList.contains("show") && !isRootLevel) {
            button.click();
        }
    });
}

// Handle "open with" functionality from Tauri
// openWithFile: { path, mode } of launch file `index`; its bytes are read by
// the Rust backend and handed over as a File, so the same loaders as the file
// pickers are used (including the JSONL line index).
async function handleOpenWithFile(openWithFile, index) {
    const { path: filePath, mode } = openWithFile;
    try {
        console.log(`Opening file: ${filePath} in ${mode} mode`);

        // Show the full absolute path
        updateFileNameDisplay(filePath);
        showLoading(`Reading ${filePath}…`);

        const bytes = await window.__TAURI__.core.invoke('read_open_with_file', { index });
        const fileName = filePath.split(/[\/]/).pop();
        const file = new File([bytes], fileName, { type: 'text/plain' });

        if (mode === 'jsonl') {
            await renderJsonlFile(file);
        } else if (hasExtension(file, ".json", ".geojson")) {
            hideJsonlControls();
            await renderJsonFile(file);
        } else {
            // Launched from the command line with another extension: treat as JSON
            hideJsonlControls();
            let text = await readFileText(file);
            if (text === null) {
                document.querySelector("#view").replaceChildren();
                displayParseError(fileTooLargeError(file));
            } else {
                renderJsonStr(text);
            }
        }
    } catch (error) {
        console.error('Error opening file:', error);
        
        // Display error to user
        document.querySelector("#view").replaceChildren();
        displayParseError({
            type: 'File Open Error',
            error: `Failed to open file: ${error.message ?? error}`
        });
    }
}

let loader = new WebDataLoader();
loader.loadObject(welcome);
renderJSON(loader);