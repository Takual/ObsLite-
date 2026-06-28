(function () {
    'use strict';

    const STORAGE_KEY = 'minivault_notes';
    const INIT_KEY = 'minivault_initialized';
    const DEFAULT_NOTE = 'home';

    const DEFAULT_NOTES = {
        'home': null,
        'beispiel-notiz': null,
        'zweite-notiz': null
    };

    let notes = {};
    let currentNote = null;
    let editMode = false;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // --- Storage ---

    function saveNotes() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    }

    function loadNotes() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            notes = JSON.parse(stored);
        }
    }

    // --- Init ---

    async function init() {
        loadNotes();

        if (!localStorage.getItem(INIT_KEY)) {
            await loadDefaultNotes();
            localStorage.setItem(INIT_KEY, '1');
        }

        renderNoteList();
        navigateTo(getHashNote() || DEFAULT_NOTE);
        setupEventListeners();
    }

    async function loadDefaultNotes() {
        for (const name of Object.keys(DEFAULT_NOTES)) {
            if (notes[name]) continue;
            try {
                const resp = await fetch('vault/' + name + '.md');
                if (resp.ok) {
                    notes[name] = await resp.text();
                }
            } catch (e) {
                notes[name] = '# ' + name + '\n\nNeue Notiz.';
            }
        }
        saveNotes();
    }

    function getHashNote() {
        const hash = location.hash.slice(1);
        return hash || null;
    }

    // --- Rendering ---

    function renderNoteList(filter) {
        const list = $('#note-list');
        const sorted = Object.keys(notes).sort((a, b) => {
            if (a === 'home') return -1;
            if (b === 'home') return 1;
            return a.localeCompare(b);
        });

        list.innerHTML = '';
        for (const name of sorted) {
            if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
            const div = document.createElement('div');
            div.className = 'note-item' + (name === currentNote ? ' active' : '');
            div.textContent = name;
            div.onclick = () => navigateTo(name);

            if (name !== 'home') {
                const del = document.createElement('button');
                del.className = 'delete-btn';
                del.textContent = '×';
                del.onclick = (e) => {
                    e.stopPropagation();
                    deleteNote(name);
                };
                div.appendChild(del);
            }

            list.appendChild(div);
        }
    }

    function renderNote() {
        if (!currentNote || !notes[currentNote]) return;

        const content = notes[currentNote];
        $('.note-title').textContent = currentNote;

        if (editMode) {
            $('#viewer').style.display = 'none';
            $('#editor').style.display = 'block';
            $('#editor textarea').value = content;
        } else {
            $('#editor').style.display = 'none';
            $('#viewer').style.display = 'block';
            $('#viewer').innerHTML = renderMarkdown(content);
            bindWikilinks();
        }

        renderBacklinks();
    }

    function renderMarkdown(text) {
        const wikilinkPlaceholders = [];
        const processed = text.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
            const slug = slugify(name);
            const exists = notes.hasOwnProperty(slug);
            const placeholder = '\x00WL' + wikilinkPlaceholders.length + '\x00';
            wikilinkPlaceholders.push(
                '<a class="wikilink' + (exists ? '' : ' broken') + '" data-note="' + slug + '">' + name + '</a>'
            );
            return placeholder;
        });

        let html = marked.parse(processed);

        wikilinkPlaceholders.forEach((replacement, i) => {
            html = html.replace('\x00WL' + i + '\x00', replacement);
        });

        return html;
    }

    function bindWikilinks() {
        $$('.wikilink').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const target = el.dataset.note;
                if (!notes[target]) {
                    notes[target] = '# ' + target + '\n\nNeue Notiz.';
                    saveNotes();
                    renderNoteList();
                }
                navigateTo(target);
            });
        });
    }

    function renderBacklinks() {
        const list = $('#backlinks-list');
        list.innerHTML = '';

        if (!currentNote) return;

        const pattern = '[[' + currentNote + ']]';
        for (const [name, content] of Object.entries(notes)) {
            if (name === currentNote) continue;
            if (content && content.includes(pattern)) {
                const div = document.createElement('div');
                div.className = 'backlink-item';
                div.textContent = name;

                const idx = content.indexOf(pattern);
                const start = Math.max(0, idx - 40);
                const end = Math.min(content.length, idx + pattern.length + 40);
                const ctx = document.createElement('div');
                ctx.className = 'backlink-context';
                ctx.textContent = '...' + content.slice(start, end).replace(/\n/g, ' ') + '...';
                div.appendChild(ctx);

                div.onclick = () => navigateTo(name);
                list.appendChild(div);
            }
        }

        if (!list.children.length) {
            list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;">Keine Backlinks</div>';
        }
    }

    // --- Navigation ---

    function navigateTo(name) {
        if (editMode) saveCurrentEdit();
        editMode = false;
        currentNote = name;
        location.hash = name;
        renderNoteList();
        renderNote();
        updateToolbarButtons();
    }

    // --- Edit ---

    function toggleEdit() {
        if (editMode) {
            saveCurrentEdit();
            editMode = false;
        } else {
            editMode = true;
        }
        renderNote();
        updateToolbarButtons();
    }

    function saveCurrentEdit() {
        if (!currentNote) return;
        const textarea = $('#editor textarea');
        if (textarea) {
            notes[currentNote] = textarea.value;
            saveNotes();
        }
    }

    function updateToolbarButtons() {
        const btn = $('#btn-edit');
        if (btn) {
            btn.textContent = editMode ? 'Ansicht' : 'Bearbeiten';
            btn.classList.toggle('active', editMode);
        }
    }

    // --- Note Management ---

    function createNote() {
        $('#new-note-modal').classList.add('visible');
        const input = $('#new-note-name');
        input.value = '';
        input.focus();
    }

    function confirmCreateNote() {
        const input = $('#new-note-name');
        const name = slugify(input.value.trim());
        if (!name) return;
        if (notes[name]) {
            navigateTo(name);
        } else {
            notes[name] = '# ' + input.value.trim() + '\n\nNeue Notiz.';
            saveNotes();
            renderNoteList();
            navigateTo(name);
        }
        $('#new-note-modal').classList.remove('visible');
    }

    function deleteNote(name) {
        if (!confirm('Notiz "' + name + '" wirklich löschen?')) return;
        delete notes[name];
        saveNotes();
        if (currentNote === name) {
            navigateTo(DEFAULT_NOTE);
        }
        renderNoteList();
    }

    function exportZip() {
        const zip = new JSZip();
        for (const [name, content] of Object.entries(notes)) {
            zip.file(name + '.md', content);
        }
        zip.generateAsync({ type: 'blob' }).then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'minivault-export.zip';
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }

    // --- Graph ---

    function showGraph() {
        $('#graph-overlay').style.display = 'block';
        renderGraph();
    }

    function hideGraph() {
        $('#graph-overlay').style.display = 'none';
        const svg = $('#graph-container svg');
        if (svg) svg.remove();
    }

    function renderGraph() {
        const container = $('#graph-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        const nodeNames = Object.keys(notes);
        const nodeMap = {};
        const nodes = nodeNames.map((name, i) => {
            const node = { id: name, index: i };
            nodeMap[name] = node;
            return node;
        });

        const links = [];
        const seen = new Set();
        for (const [name, content] of Object.entries(notes)) {
            if (!content) continue;
            const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
            for (const m of matches) {
                const target = slugify(m.slice(2, -2));
                if (nodeMap[target] && name !== target) {
                    const key = [name, target].sort().join('|');
                    if (!seen.has(key)) {
                        seen.add(key);
                        links.push({ source: nodeMap[name], target: nodeMap[target] });
                    }
                }
            }
        }

        const svg = d3.select(container).append('svg')
            .attr('width', width)
            .attr('height', height);

        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).distance(120))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(40));

        const link = svg.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', '#2a2a4a')
            .attr('stroke-width', 1.5);

        const node = svg.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .style('cursor', 'pointer')
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                }));

        node.append('circle')
            .attr('r', d => d.id === currentNote ? 10 : 7)
            .attr('fill', d => d.id === currentNote ? '#e94560' : '#53a8e2');

        node.append('text')
            .text(d => d.id)
            .attr('dx', 14)
            .attr('dy', 4)
            .attr('fill', '#a0a0b0')
            .attr('font-size', '12px');

        node.on('click', (event, d) => {
            hideGraph();
            navigateTo(d.id);
        });

        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);
            node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
        });
    }

    // --- Utilities ---

    function slugify(text) {
        return text.toLowerCase().trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9äöüß\-]/g, '');
    }

    // --- Events ---

    function setupEventListeners() {
        $('#btn-new').onclick = createNote;
        $('#btn-export').onclick = exportZip;
        $('#btn-edit').onclick = toggleEdit;
        $('#btn-graph').onclick = showGraph;
        $('#graph-close').onclick = hideGraph;
        $('#search-box').oninput = (e) => renderNoteList(e.target.value);

        $('#btn-create-confirm').onclick = confirmCreateNote;
        $('#btn-create-cancel').onclick = () => $('#new-note-modal').classList.remove('visible');
        $('#new-note-name').onkeydown = (e) => {
            if (e.key === 'Enter') confirmCreateNote();
            if (e.key === 'Escape') $('#new-note-modal').classList.remove('visible');
        };

        window.addEventListener('hashchange', () => {
            const name = getHashNote();
            if (name && name !== currentNote) navigateTo(name);
        });

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                toggleEdit();
            }
            if (e.key === 'Escape') {
                if ($('#graph-overlay').style.display === 'block') hideGraph();
                if ($('#new-note-modal').classList.contains('visible')) {
                    $('#new-note-modal').classList.remove('visible');
                }
            }
        });
    }

    // --- Start ---

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
