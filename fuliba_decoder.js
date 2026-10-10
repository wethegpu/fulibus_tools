// ==UserScript==
// @name         福利吧工具箱
// @namespace    http://tampermonkey.net/
// @version      0.10
// @description  适配最新版百家姓，并且增加一键复制功能。高亮好孩子看不见
// @description:zh-cn 适配最新版百家姓，并且增加一键复制功能。高亮好孩子看不见
// @author       Wee
// @license      MIT
// @match        *://fuliba2023.net/*
// @match        *://fuliba2024.net/*
// @match        *://fuliba2025.net/*
// @match        *://fuliba2026.net/*
// @match        *://fuliba2027.net/*
// @match        *://f.uliba.net/*
// @match        *://fuliba66.net/*
// @match        *://fuliba23.net/*
// @match        *://fulibus.net/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
// Copyright (c) 2024 Wee. Released under the MIT License.
// 允许自由使用与修改，但须保留原作者（Wee）的版权声明。

(function () {
    'use strict';

    // https://www.bjxah.com/guide.html#guide-map：75 个标准字符及旧版卜别名。
    const surnameMap = {
        "赵":"0","钱":"1","孙":"2","李":"3","周":"4","吴":"5","郑":"6","王":"7","冯":"8","陈":"9",
        "褚":"a","卫":"b","蒋":"c","沈":"d","韩":"e","杨":"f","朱":"g","秦":"h","尤":"i","许":"j",
        "何":"k","吕":"l","施":"m","张":"n","孔":"o","曹":"p","严":"q","华":"r","金":"s","魏":"t",
        "陶":"u","姜":"v","戚":"w","谢":"x","邹":"y","喻":"z",
        "福":"A","水":"B","窦":"C","章":"D","云":"E","苏":"F","潘":"G","葛":"H","奚":"I","范":"J",
        "彭":"K","郎":"L","鲁":"M","韦":"N","昌":"O","马":"P","苗":"Q","凤":"R","花":"S","方":"T",
        "俞":"U","任":"V","袁":"W","柳":"X","唐":"Y","罗":"Z",
        "薛":".","伍":"-","余":"_","米":"+","贝":"=","姚":"/","孟":"?","顾":"#","尹":"%",
        "江":"&","钟":"*","竺":":","赖":"|","卜":"|",
    };

    const MAGNET_HEADER = 'magnet:?xt=urn:btih:';
    const MAGNET_HASH_PATTERN = /^[0-9a-fA-F]{40}(?:&[a-zA-Z0-9_.~-]+=[^\s&]*)*$/;
    const MAGNET_LINK_PATTERN = /^magnet:\?xt=urn:btih:[0-9a-fA-F]{40}(?:&[a-zA-Z0-9_.~-]+=[^\s&]*)*$/i;
    const ED2K_LINK_PATTERN = /^ed2k:\/\/\|file\|[^|]+\|\d+\|[0-9a-fA-F]{32}\|\/$/i;

    function applyMagnetPrefix(decoded) {
        return MAGNET_HASH_PATTERN.test(decoded) ? MAGNET_HEADER + decoded : decoded;
    }

    function decodeSurnameText(text) {
        let result = '';
        for (const ch of text) {
            if (/\s/.test(ch)) continue;
            if (!Object.prototype.hasOwnProperty.call(surnameMap, ch)) return null;
            result += surnameMap[ch];
        }
        // 保留 %XX 转义，避免提前解码改变 URL 参数和路径的含义。
        return applyMagnetPrefix(result);
    }

    function isDecodedLink(text) {
        if (MAGNET_LINK_PATTERN.test(text) || ED2K_LINK_PATTERN.test(text)) return true;
        if (/^thunder:\/\/[a-zA-Z0-9+/]+={0,2}$/i.test(text)) return true;
        if (!/^(?:https?:\/\/|ftp:\/\/|www\.)/i.test(text)) return false;
        try {
            const url = new URL(/^www\./i.test(text) ? 'https://' + text : text);
            return Boolean(url.hostname);
        } catch {
            return false;
        }
    }

    function decodeCommentLine(line) {
        const labelled = line.match(/^([^:：]+[:：]\s*)(.*)$/);
        const prefix = labelled ? labelled[1] : '';
        const candidate = labelled ? labelled[2] : line;
        const decoded = decodeSurnameText(candidate);
        if (!decoded || !isDecodedLink(decoded)) return null;
        return { display: prefix + decoded, link: decoded };
    }

    function createCopyButton(text) {
        const btn = document.createElement('a');
        btn.href = 'javascript:void(0)';
        btn.textContent = '[复制]';
        btn.style.cssText = 'margin-left:8px;font-size:12px;color:#888;text-decoration:none;cursor:pointer';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.writeText(text).then(() => {
                btn.textContent = '[已复制]';
                btn.style.color = '#e0b354';
                setTimeout(() => {
                    btn.textContent = '[复制]';
                    btn.style.color = '#888';
                }, 1500);
            });
        });
        return btn;
    }

    function replaceParagraphContent(pElement, decodedLines) {
        pElement.dataset.bjxahDecoded = '1';
        while (pElement.firstChild) pElement.removeChild(pElement.firstChild);
        decodedLines.forEach((line, idx) => {
            if (idx > 0) pElement.appendChild(document.createElement('br'));
            pElement.appendChild(document.createTextNode(line.display));
            if (line.link) pElement.appendChild(createCopyButton(line.link));
        });
    }

    function processCommentParagraph(pElement) {
        if (pElement.dataset.bjxahDecoded === '1') return;

        const text = (pElement.innerText ?? pElement.textContent).trim();

        const decodedLines = text.split(/\r?\n/).map((line) => {
            return decodeCommentLine(line) || { display: line };
        });
        if (!decodedLines.some((line) => line.link)) return;
        replaceParagraphContent(pElement, decodedLines);
    }

    function processAllComments() {
        document.querySelectorAll('.comt-main p').forEach(processCommentParagraph);
    }

    /* ============================================================
       隐藏白字高亮
       ============================================================ */

    const WHITE_COLOR_PATTERNS = [
        /color\s*:\s*#ffffff\b/i,
        /color\s*:\s*#fff\b/i,
        /color\s*:\s*white\b/i,
        /color\s*:\s*rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i,
    ];

    function isWhiteColorStyle(styleStr) {
        if (!styleStr) return false;
        return WHITE_COLOR_PATTERNS.some((re) => re.test(styleStr));
    }

    function highlightHiddenText(roots) {
        for (const root of roots) {
            root.querySelectorAll('span[style*="color"]').forEach((span) => {
                if (span.dataset.bjxahHighlighted === '1') return;
                if (!isWhiteColorStyle(span.getAttribute('style') || '')) return;

                span.dataset.bjxahHighlighted = '1';
                span.style.color = '#d63384';
                span.style.backgroundColor = '#fff3cd';
                span.style.padding = '0 4px';
                span.style.borderRadius = '3px';
                span.style.fontWeight = 'bold';
            });
        }
    }

    processAllComments();
    const contentRoots = document.querySelectorAll('div.content');
    if (contentRoots.length > 0) {
        highlightHiddenText(contentRoots);
    }
})();
