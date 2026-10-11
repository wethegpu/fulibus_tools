const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { parseHTML } = require('linkedom');
const { fixtures } = require('./fixtures/bjxah-codecs.json');

// 独立测试数据取自 https://www.bjxah.com/guide.html#guide-map。
const standardNames = '赵钱孙李周吴郑王冯陈'
    + '褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻'
    + '福水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳唐罗'
    + '薛伍余米贝姚孟顾尹江钟竺赖';
const standardText = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-_+=/?#%&*:|';
const hash = '0123456789abcdef0123456789abcdef01234567';
const header = 'magnet:?xt=urn:btih:';
const source = fs.readFileSync(path.join(__dirname, '..', 'fuliba_decoder.js'), 'utf8');
const instrumented = source.replace('    await processAllComments();',
    '    globalThis.decoder = { decodeSurnameText, applyMagnetPrefix, decodeCoreValuesText, decodeBuddhaText, processCommentParagraph };\n    await processAllComments();');
assert.notEqual(instrumented, source, '必须执行实际用户脚本并暴露解码函数');

function encode(text) {
    return Array.from(text, (ch) => {
        const index = standardText.indexOf(ch);
        assert.notEqual(index, -1, `测试样本中未转义的字符：${ch}`);
        return standardNames[index];
    }).join('');
}

async function run(html = '', crypto = webcrypto) {
    const { document, window } = parseHTML(html);
    const copied = [];
    const context = vm.createContext({
        document,
        URL,
        TextEncoder,
        TextDecoder,
        crypto,
        navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
        setTimeout: () => {},
    });
    await vm.runInContext(instrumented, context);
    return { document, window, copied, context, decoder: context.decoder };
}

test('完整映射：75 个文档字符、旧版卜、空白和未知字符', async () => {
    assert.equal(standardNames.length, 75);
    const { decoder } = await run();
    assert.equal(decoder.decodeSurnameText(standardNames), standardText);
    assert.equal(decoder.decodeSurnameText('卜'), '|');
    assert.equal(decoder.decodeSurnameText(' 褚 \t卫 '), 'ab');
    assert.equal(decoder.decodeSurnameText('褚未知卫'), null);
});

test('按文档还原 HTTP、完整 magnet、ed2k、旧版 ed2k 和百分号转义', async () => {
    const { decoder } = await run();
    const samples = [
        'https://example.com/a-b_c?q=x+y&n=1#part',
        header + hash,
        'ed2k://|file|demo.zip|123|0123456789abcdef0123456789abcdef|/',
        'https://example.com/%E4%B8%AD?q=a%26b%3Dc',
        'thunder://QUFkZW1vWlo=',
    ];
    for (const sample of samples) {
        assert.equal(decoder.decodeSurnameText(encode(sample)), sample);
    }
    const ed2k = samples[2];
    assert.equal(decoder.decodeSurnameText(encode(ed2k).replaceAll('赖', '卜')), ed2k);
});

test('仅完整 40 位哈希及其参数补磁力头，拒绝短哈希和错误后缀', async () => {
    const { decoder } = await run();
    assert.equal(decoder.decodeSurnameText(encode(hash)), header + hash);
    assert.equal(decoder.decodeSurnameText(encode(hash + '&dn=demo.zip')), header + hash + '&dn=demo.zip');
    for (const invalid of [hash.slice(1), hash + 'a', hash + 'z', hash + '&broken']) {
        assert.equal(decoder.applyMagnetPrefix(invalid), invalid);
    }
});

test('双暗号评论：保留花火/昔涟标签，每条链接分别复制且按钮反馈独立', async () => {
    const fire = '苏水钱钱李章孙水章陈周苏陈福窦陈赵冯钱云陈吴赵冯云陈福王钱陈福李冯郑水郑赵陈窦吴';
    const ice = '吴钱李郑章陈陈云郑赵冯窦钱钱苏郑苏章冯冯郑赵周章福李陈水冯王云吴窦孙郑冯福福孙冯';
    const fireLink = header + 'FB113D2BD94F9AC9081E9508E9A719A386B609C5';
    const iceLink = header + '5136D99E608C11F6FD88604DA39B87E5C268AA28';
    const result = await run(`<div class="comt-main"><p>说明文字<br>花火：${fire}<br>昔涟：${ice}</p></div>`);
    const paragraph = result.document.querySelector('p');
    assert.equal(paragraph.innerText, `说明文字\n花火：${fireLink}[复制]\n昔涟：${iceLink}[复制]`);
    const buttons = paragraph.querySelectorAll('a');
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].previousSibling.textContent, '花火：' + fireLink);
    assert.equal(buttons[1].previousSibling.textContent, '昔涟：' + iceLink);
    const before = paragraph.toString();
    await vm.runInContext(instrumented, result.context);
    assert.equal(paragraph.toString(), before);
    buttons[0].dispatchEvent(new result.window.Event('click', { cancelable: true }));
    await Promise.resolve();
    assert.deepEqual(result.copied, [fireLink]);
    assert.equal(buttons[0].textContent, '[已复制]');
    assert.equal(buttons[1].textContent, '[复制]');
    buttons[1].dispatchEvent(new result.window.Event('click', { cancelable: true }));
    await Promise.resolve();
    assert.deepEqual(result.copied, [fireLink, iceLink]);
    assert.equal(buttons[1].textContent, '[已复制]');
});

test('单暗号与普通文字混排：只给解码链接添加按钮并只复制链接', async () => {
    const link = header + hash;
    const result = await run(`<div class="comt-main"><p>说明文字<br>下载：${encode(hash)}<br>结束文字</p></div>`);
    const paragraph = result.document.querySelector('p');
    assert.equal(paragraph.innerText, `说明文字\n下载：${link}[复制]\n结束文字`);
    const buttons = paragraph.querySelectorAll('a');
    assert.equal(buttons.length, 1);
    buttons[0].dispatchEvent(new result.window.Event('click', { cancelable: true }));
    await Promise.resolve();
    assert.deepEqual(result.copied, [link]);
});

test('真实故障：包含竺的 URL；支持英文冒号、旧版卜与磁力参数', async () => {
    const ed2k = 'ed2k://|file|demo.zip|123|0123456789abcdef0123456789abcdef|/';
    const result = await run(`<div class="comt-main"><p>次元W社区？<br>秦魏魏曹金竺姚姚赵戚赵钱薛魏孔曹姚</p>`
        + `<p>下载: ${encode(hash + '&dn=demo.zip')}</p><p>${encode(ed2k).replaceAll('赖', '卜')}</p></div>`);
    const paragraphs = result.document.querySelectorAll('p');
    assert.equal(paragraphs[0].innerText, '次元W社区？\nhttps://0w01.top/[复制]');
    assert.equal(paragraphs[1].innerText, '下载: ' + header + hash + '&dn=demo.zip[复制]');
    assert.equal(paragraphs[2].innerText, ed2k + '[复制]');
});

test('普通姓氏、损坏暗号、错误哈希和协议头均不修改', async () => {
    const texts = ['赵钱孙李周吴郑王', '花火：' + encode(hash) + '未知', encode(hash + 'a'),
        encode(hash + 'z'), encode('https:'), encode(header + hash + 'a'), 'https://example.com/'];
    const result = await run('<div class="comt-main">' + texts.map((text) => `<p>${text}</p>`).join('') + '</div>');
    Array.from(result.document.querySelectorAll('p')).forEach((paragraph, index) => {
        assert.equal(paragraph.innerText, texts[index]);
        assert.equal(paragraph.dataset.bjxahDecoded, undefined);
        assert.equal(paragraph.querySelector('a'), null);
    });
});

test('重复执行不重复生成按钮，并保留隐藏白字高亮行为', async () => {
    const result = await run(`<div class="comt-main"><p>${encode(hash)}</p></div>`
        + '<div class="content"><span style="color:#fff">隐藏文字</span><span style="color:red">普通文字</span></div>');
    const before = result.document.toString();
    await vm.runInContext(instrumented, result.context);
    assert.equal(result.document.toString(), before);
    assert.equal(result.document.querySelectorAll('p a').length, 1);
    assert.equal(result.document.querySelector('.content span').dataset.bjxahHighlighted, '1');
    assert.equal(result.document.querySelector('.content span:last-child').dataset.bjxahHighlighted, undefined);
});

test('官网生成的核心价值观及佛曰样本：链接、中文、代理项和整块填充逐项解码', async () => {
    const { decoder } = await run();
    for (const fixture of fixtures) {
        assert.equal(decoder.decodeCoreValuesText(fixture.coreValues), fixture.plain);
        assert.equal(await decoder.decodeBuddhaText(fixture.buddha), fixture.plain);
    }
});

test('与佛论禅支持所有高位标记、空白及佛又曰/英文冒号前缀', async () => {
    const { decoder } = await run();
    const fixture = fixtures[0];
    for (const marker of '冥奢梵呐俱哆怯諳罰侄缽皤') {
        const cipher = fixture.buddha.replace(/[冥奢梵呐俱哆怯諳罰侄缽皤]/g, marker);
        assert.equal(await decoder.decodeBuddhaText(cipher), fixture.plain);
    }
    assert.equal(await decoder.decodeBuddhaText(fixture.buddha.replace('佛曰：', '佛又曰:')), fixture.plain);
    assert.equal(await decoder.decodeBuddhaText(fixture.buddha.replace('佛曰：', '佛曰')), fixture.plain);
    assert.equal(await decoder.decodeBuddhaText(fixture.buddha.split('').join(' ')), fixture.plain);
    assert.equal(decoder.decodeCoreValuesText(fixture.coreValues.split('').join(' ')), fixture.plain);
});

test('三种暗号混排：任意标签、哈希补磁力头与独立复制，普通说明不添加按钮', async () => {
    const fixture = fixtures.find((item) => item.plain === hash);
    const result = await run(`<div class="comt-main"><p>说明文字<br>资源一：${encode(hash)}`
        + `<br>资源二: ${fixture.coreValues}<br>资源三：${fixture.buddha}</p></div>`);
    const paragraph = result.document.querySelector('p');
    const link = header + hash;
    assert.equal(paragraph.innerText, `说明文字\n资源一：${link}[复制]\n资源二: ${link}[复制]\n资源三：${link}[复制]`);
    const buttons = paragraph.querySelectorAll('a');
    assert.equal(buttons.length, 3);
    for (const button of buttons) button.dispatchEvent(new result.window.Event('click', { cancelable: true }));
    await Promise.resolve();
    assert.deepEqual(result.copied, [link, link, link]);
});

test('核心价值观与佛曰的普通明文也可复制，佛曰前缀不会被当作评论标签', async () => {
    const fixture = fixtures[0];
    const result = await run(`<div class="comt-main"><p>${fixture.coreValues}</p><p>${fixture.buddha}</p>`
        + `<p>${fixture.buddha.split('').join(' ')}</p></div>`);
    for (const paragraph of result.document.querySelectorAll('p')) {
        assert.equal(paragraph.innerText, fixture.plain + '[复制]');
        paragraph.querySelector('a').dispatchEvent(new result.window.Event('click', { cancelable: true }));
    }
    await Promise.resolve();
    assert.deepEqual(result.copied, [fixture.plain, fixture.plain, fixture.plain]);
});

test('解码明文中的换行正常显示，HTML 按文字展示，复制保留原文', async () => {
    const multiline = fixtures.find((fixture) => fixture.plain.includes('\n'));
    const htmlText = fixtures.find((fixture) => fixture.plain.startsWith('<img'));
    const result = await run(`<div class="comt-main"><p>${multiline.buddha}</p><p>${htmlText.coreValues}</p></div>`);
    const paragraphs = result.document.querySelectorAll('p');
    assert.equal(paragraphs[0].innerText, multiline.plain + '[复制]');
    assert.equal(paragraphs[0].querySelectorAll('br').length, 1);
    assert.equal(paragraphs[1].innerText, htmlText.plain + '[复制]');
    assert.equal(paragraphs[1].querySelector('img'), null);
    for (const paragraph of paragraphs) {
        paragraph.querySelector('a').dispatchEvent(new result.window.Event('click', { cancelable: true }));
    }
    await Promise.resolve();
    assert.deepEqual(result.copied, [multiline.plain, htmlText.plain]);
});

test('损坏暗号、字节溢出和非法 UTF-8 保留原文，不影响同页其他暗号', async () => {
    const fixture = fixtures[0];
    const texts = [
        '富强民主文明和谐自由平等公正法治爱国敬业诚信友善',
        '富强富强强富',
        '民主爱国自由', // 244：单独的 UTF-8 起始字节。
        '民主敬业自由', // 256：不能截断为 0。
        fixture.coreValues.slice(0, -1),
        fixture.buddha + '冥',
        fixture.buddha.slice(0, -1),
        fixture.buddha + '未知',
        '佛曰：' + '滅'.repeat(16),
    ];
    const result = await run('<div class="comt-main">' + texts.map((text) => `<p>${text}</p>`).join('')
        + `<p>${encode(hash)}</p></div>`);
    const paragraphs = result.document.querySelectorAll('p');
    texts.forEach((text, index) => {
        assert.equal(paragraphs[index].innerText, text);
        assert.equal(paragraphs[index].querySelector('a'), null);
        assert.equal(paragraphs[index].dataset.bjxahDecoding, undefined);
    });
    assert.equal(paragraphs[texts.length].innerText, header + hash + '[复制]');
});

test('缺少 Web Crypto 时仅保留佛曰密文，百家姓和核心价值观继续解码', async () => {
    const fixture = fixtures[0];
    const result = await run(`<div class="comt-main"><p>${fixture.buddha}</p>`
        + `<p>${fixture.coreValues}</p><p>${encode(hash)}</p></div>`, null);
    const paragraphs = result.document.querySelectorAll('p');
    assert.equal(paragraphs[0].innerText, fixture.buddha);
    assert.equal(paragraphs[0].querySelector('a'), null);
    assert.equal(paragraphs[1].innerText, fixture.plain + '[复制]');
    assert.equal(paragraphs[2].innerText, header + hash + '[复制]');
});

test('佛曰异步处理防止重复按钮，并保留解密期间更新的评论', async () => {
    const { document, decoder } = await run();
    const fixture = fixtures[0];
    const paragraph = document.createElement('p');
    paragraph.textContent = fixture.buddha;
    const pending = decoder.processCommentParagraph(paragraph);
    assert.equal(paragraph.dataset.bjxahDecoding, '1');
    await decoder.processCommentParagraph(paragraph);
    await pending;
    assert.equal(paragraph.querySelectorAll('a').length, 1);
    assert.equal(paragraph.dataset.bjxahDecoding, undefined);
    const updated = document.createElement('p');
    updated.textContent = fixture.buddha;
    const decrypting = decoder.processCommentParagraph(updated);
    updated.textContent = '更新后的普通评论';
    await decrypting;
    assert.equal(updated.innerText, '更新后的普通评论');
    assert.equal(updated.querySelector('a'), null);
});
