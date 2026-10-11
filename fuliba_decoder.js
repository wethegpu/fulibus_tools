// ==UserScript==
// @name         福利吧工具箱
// @namespace    http://tampermonkey.net/
// @version      0.11
// @description  解码百家姓、核心价值观和与佛论禅暗号，逐条复制结果，高亮好孩子看不见
// @description:zh-cn 解码百家姓、核心价值观和与佛论禅暗号，逐条复制结果，高亮好孩子看不见
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

(async function () {
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

    // 以 bjxah.com 首页实际实现为准：每个 UTF-8 字节对应三个核心价值观词。
    const CORE_VALUES = ['富强', '民主', '文明', '和谐', '自由', '平等',
        '公正', '法治', '爱国', '敬业', '诚信', '友善'];
    const BUDDHA_CHARACTERS = '滅苦婆娑耶陀跋多漫都殿悉夜爍帝吉'
        + '利阿無南那怛喝羯勝摩伽謹波者穆僧'
        + '室藝尼瑟地彌菩提蘇醯盧呼舍佛參沙'
        + '伊隸麼遮闍度蒙孕薩夷迦他姪豆特逝'
        + '朋輸楞栗寫數曳諦羅曰咒即密若般故'
        + '不實真訶切一除能等是上明大神知三'
        + '藐耨得依諸世槃涅竟究想夢倒顛離遠'
        + '怖恐有礙心所以亦智道。集盡死老至';
    const BUDDHA_MARKERS = '冥奢梵呐俱哆怯諳罰侄缽皤';
    // 公开的协议常量，与官网保持一致。
    const BUDDHA_KEY = 'XDXDtudou@KeyFansClub^_^Encode!!';
    const BUDDHA_IV = 'Potato@Key@_@=_=';

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

    function decodeTextBytes(bytes, encoding) {
        try {
            const text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
            if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
            return text;
        } catch {
            return null;
        }
    }

    function decodeCoreValuesText(text) {
        const compact = text.replace(/\s+/g, '');
        if (!compact || compact.length % 6 !== 0) return null;
        const bytes = new Uint8Array(compact.length / 6);
        for (let i = 0; i < compact.length; i += 6) {
            let value = 0;
            for (let j = 0; j < 3; j++) {
                const digit = CORE_VALUES.indexOf(compact.slice(i + j * 2, i + j * 2 + 2));
                if (digit < 0) return null;
                value = value * 12 + digit;
            }
            if (value > 255) return null;
            bytes[i / 6] = value;
        }
        return decodeTextBytes(bytes, 'utf-8');
    }

    function decodeBuddhaBytes(text) {
        const compact = text.replace(/\s+/g, '');
        if (!/^佛(?:又)?曰/.test(compact)) return null;
        const body = compact.replace(/^佛(?:又)?曰[：:]*/, '');
        const bytes = [];
        for (let i = 0; i < body.length; i++) {
            const high = BUDDHA_MARKERS.includes(body[i]);
            const index = BUDDHA_CHARACTERS.indexOf(body[high ? ++i : i] ?? '');
            if (i >= body.length || index < 0) return null;
            bytes.push(index + (high ? 128 : 0));
        }
        if (!bytes.length || bytes.length % 16 !== 0) return null;
        return new Uint8Array(bytes);
    }

    async function decodeBuddhaText(text) {
        const bytes = decodeBuddhaBytes(text);
        if (!bytes || !globalThis.crypto?.subtle) return null;
        try {
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey('raw', encoder.encode(BUDDHA_KEY), 'AES-CBC', false, ['decrypt']);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: encoder.encode(BUDDHA_IV) }, key, bytes);
            let plain = new Uint8Array(decrypted);
            // Web Crypto 已去除一层 PKCS#7；官网还在加密前手动填充了一层。
            const padding = plain[plain.length - 1];
            if (padding >= 1 && padding <= 16 && padding <= plain.length
                && plain.slice(-padding).every((byte) => byte === padding)) {
                plain = plain.slice(0, -padding);
            }
            if (plain.length % 2 !== 0) return null;
            return decodeTextBytes(plain, 'utf-16le');
        } catch {
            return null;
        }
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

    async function decodeEncodedText(text) {
        if (/^佛(?:又)?曰/.test(text.replace(/\s+/g, ''))) return decodeBuddhaText(text);
        const values = decodeCoreValuesText(text);
        if (values !== null) return values;
        const surname = decodeSurnameText(text);
        return surname && isDecodedLink(surname) ? surname : null;
    }

    async function decodeCommentLine(line) {
        const labelled = !/^佛(?:又)?曰/.test(line.replace(/\s+/g, '')) && line.match(/^([^:：]+[:：]\s*)(.*)$/);
        const prefix = labelled ? labelled[1] : '';
        const candidate = labelled ? labelled[2] : line;
        const decoded = await decodeEncodedText(candidate);
        if (!decoded) return null;
        const copyText = applyMagnetPrefix(decoded);
        return { display: prefix + copyText, copyText };
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
            line.display.split(/\r?\n/).forEach((text, lineIndex) => {
                if (lineIndex > 0) pElement.appendChild(document.createElement('br'));
                pElement.appendChild(document.createTextNode(text));
            });
            if (line.copyText) pElement.appendChild(createCopyButton(line.copyText));
        });
    }

    async function processCommentParagraph(pElement) {
        if (pElement.dataset.bjxahDecoded === '1' || pElement.dataset.bjxahDecoding === '1') return;
        const text = (pElement.innerText ?? pElement.textContent).trim();
        pElement.dataset.bjxahDecoding = '1';
        try {
            const decodedLines = await Promise.all(text.split(/\r?\n/).map(async (line) => {
                return await decodeCommentLine(line) || { display: line };
            }));
            if (!decodedLines.some((line) => line.copyText)) return;
            if ((pElement.innerText ?? pElement.textContent).trim() !== text) return;
            replaceParagraphContent(pElement, decodedLines);
        } finally {
            delete pElement.dataset.bjxahDecoding;
        }
    }

    async function processAllComments() {
        await Promise.all(Array.from(document.querySelectorAll('.comt-main p'), processCommentParagraph));
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

    await processAllComments();
    const contentRoots = document.querySelectorAll('div.content');
    if (contentRoots.length > 0) {
        highlightHiddenText(contentRoots);
    }
})();
