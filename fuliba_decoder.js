// ==UserScript==
// @name         福利吧工具箱
// @namespace    http://tampermonkey.net/
// @version      0.8
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

    // 字母数字部分两套编码完全一致，仅特殊符号映射不同
    const mapBase = {
        "赵":"0","钱":"1","孙":"2","李":"3","周":"4","吴":"5","郑":"6","王":"7","冯":"8","陈":"9",
        "褚":"a","卫":"b","蒋":"c","沈":"d","韩":"e","杨":"f","朱":"g","秦":"h","尤":"i","许":"j",
        "何":"k","吕":"l","施":"m","张":"n","孔":"o","曹":"p","严":"q","华":"r","金":"s","魏":"t",
        "陶":"u","姜":"v","戚":"w","谢":"x","邹":"y","喻":"z",
        "福":"A","水":"B","窦":"C","章":"D","云":"E","苏":"F","潘":"G","葛":"H","奚":"I","范":"J",
        "彭":"K","郎":"L","鲁":"M","韦":"N","昌":"O","马":"P","苗":"Q","凤":"R","花":"S","方":"T",
        "俞":"U","任":"V","袁":"W","柳":"X","唐":"Y","罗":"Z",
    };

    // bjxah.com 官方编码表：薛=: 尹=- 贝=% 钟== 顾=. 赖=空格
    const mapBjxah = {
        ...mapBase,
        "薛":":","姚":"/","孟":"?","江":"&","钟":"=","顾":".","尹":"-","余":"_","贝":"%","赖":" ",
    };

    // 福利吧论坛/sleazyfork-381494 编码表：薛=. 伍=- 尹=% 贝== 钟=* 顾=# 高=: 田=| 米=+
    const mapFuliba = {
        ...mapBase,
        "薛":".","伍":"-","余":"_","米":"+","贝":"=","姚":"/","孟":"?","顾":"#","尹":"%",
        "江":"&","钟":"*","高":":","田":"|",
    };

    const allSurnameChars = new Set([...Object.keys(mapBjxah), ...Object.keys(mapFuliba)]);

    const PROTOCOL_PREFIX_RE = /^(magnet:|https?:|thunder:|ftp:|ed2k:)/i;
    const MAGNET_HEADER = 'magnet:?xt=urn:btih:';
    const MAGNET_PATTERN = /^[0-9a-fA-F]{40,}/;

    function isSurnameCode(text) {
        if (!text || text.length < 8) return false;
        let surnameCount = 0;
        let nonWhitespaceCount = 0;
        for (const ch of text) {
            if (/\s/.test(ch)) continue;
            nonWhitespaceCount++;
            if (allSurnameChars.has(ch)) surnameCount++;
        }
        if (nonWhitespaceCount === 0) return false;
        return surnameCount / nonWhitespaceCount >= 0.95;
    }

    function decodeWith(text, map) {
        let result = '';
        for (const ch of text) {
            if (/\s/.test(ch)) continue;
            const decoded = map[ch];
            result += decoded !== undefined ? decoded : '[' + ch + ']';
        }
        return result;
    }

    function scoreDecoded(decoded) {
        let score = 0;
        if (/^[0-9a-fA-F]{40}/.test(decoded)) score += 100;
        if (PROTOCOL_PREFIX_RE.test(decoded)) score += 50;
        if (/:\/\//.test(decoded)) score += 30;
        if (/&\w+=/.test(decoded)) score += 20;
        const unknownCount = (decoded.match(/\[.\]/g) || []).length;
        score -= unknownCount * 10;
        return score;
    }

    function applyMagnetPrefix(decoded) {
        if (PROTOCOL_PREFIX_RE.test(decoded)) return decoded;
        if (MAGNET_PATTERN.test(decoded)) return MAGNET_HEADER + decoded;
        return decoded;
    }

    // 先尝试 bjxah 表，如结果置信度高（无未识别字符且得分 >=50）则跳过 fuliba 表，省一次全量遍历
    function decodeSurnameText(text) {
        const decodedA = decodeWith(text, mapBjxah);
        const scoreA = scoreDecoded(decodedA);
        if (scoreA >= 50 && !decodedA.includes('[')) {
            return applyMagnetPrefix(decodedA);
        }
        const decodedB = decodeWith(text, mapFuliba);
        const scoreB = scoreDecoded(decodedB);
        return applyMagnetPrefix(scoreB > scoreA ? decodedB : decodedA);
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

    function replaceParagraphContent(pElement, decodedLines, copyText) {
        pElement.dataset.bjxahDecoded = '1';
        while (pElement.firstChild) pElement.removeChild(pElement.firstChild);
        decodedLines.forEach((line, idx) => {
            if (idx > 0) pElement.appendChild(document.createElement('br'));
            pElement.appendChild(document.createTextNode(line));
        });
        const textToCopy = (copyText !== undefined ? copyText : decodedLines.join('\n'))
            .replace(/\[[^\]]+\]/g, '').trim();
        pElement.appendChild(createCopyButton(textToCopy));
    }

    function processCommentParagraph(pElement) {
        if (pElement.dataset.bjxahDecoded === '1') return;

        const text = (pElement.innerText ?? pElement.textContent).trim();

        // 优先处理多行内容（含 <br> 分割），避免整段文本通过 isSurnameCode 检测后将非暗号行一并解码
        if (text.includes('\n')) {
            let hasDecoded = false;
            const decodedOnlyLines = [];
            const decodedLines = text.split('\n').map((line) => {
                const trimmed = line.trim();
                if (isSurnameCode(trimmed)) {
                    hasDecoded = true;
                    const decoded = decodeSurnameText(trimmed);
                    decodedOnlyLines.push(decoded);
                    return decoded;
                }
                return line;
            });
            if (!hasDecoded) return;
            replaceParagraphContent(pElement, decodedLines, decodedOnlyLines.join('\n'));
            return;
        }

        if (isSurnameCode(text)) {
            replaceParagraphContent(pElement, [decodeSurnameText(text)]);
        }
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
