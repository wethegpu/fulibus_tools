const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

// 独立测试数据取自 https://www.bjxah.com/guide.html#guide-map。
const standardNames = '赵钱孙李周吴郑王冯陈'
    + '褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻'
    + '福水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳唐罗'
    + '薛伍余米贝姚孟顾尹江钟竺赖';
const standardText = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-_+=/?#%&*:|';
const hash = '0123456789abcdef0123456789abcdef01234567';
const header = 'magnet:?xt=urn:btih:';
const source = fs.readFileSync(path.join(__dirname, '..', 'fuliba_decoder.js'), 'utf8');
const instrumented = source.replace('    processAllComments();',
    '    globalThis.decoder = { decodeSurnameText, applyMagnetPrefix };\n    processAllComments();');
assert.notEqual(instrumented, source, '必须执行实际用户脚本并暴露解码函数');

function encode(text) {
    return Array.from(text, (ch) => {
        const index = standardText.indexOf(ch);
        assert.notEqual(index, -1, `测试样本中未转义的字符：${ch}`);
        return standardNames[index];
    }).join('');
}

function run(html = '') {
    const { document, window } = parseHTML(html);
    const copied = [];
    const context = vm.createContext({
        document,
        URL,
        navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
        setTimeout: () => {},
    });
    vm.runInContext(instrumented, context);
    return { document, window, copied, context, decoder: context.decoder };
}

test('完整映射：75 个文档字符、旧版卜、空白和未知字符', () => {
    assert.equal(standardNames.length, 75);
    const { decoder } = run();
    assert.equal(decoder.decodeSurnameText(standardNames), standardText);
    assert.equal(decoder.decodeSurnameText('卜'), '|');
    assert.equal(decoder.decodeSurnameText(' 褚 \t卫 '), 'ab');
    assert.equal(decoder.decodeSurnameText('褚未知卫'), null);
});

test('按文档还原 HTTP、完整 magnet、ed2k、旧版 ed2k 和百分号转义', () => {
    const { decoder } = run();
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

test('仅完整 40 位哈希及其参数补磁力头，拒绝短哈希和错误后缀', () => {
    const { decoder } = run();
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
    const result = run(`<div class="comt-main"><p>说明文字<br>花火：${fire}<br>昔涟：${ice}</p></div>`);
    const paragraph = result.document.querySelector('p');
    assert.equal(paragraph.innerText, `说明文字\n花火：${fireLink}[复制]\n昔涟：${iceLink}[复制]`);
    const buttons = paragraph.querySelectorAll('a');
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].previousSibling.textContent, '花火：' + fireLink);
    assert.equal(buttons[1].previousSibling.textContent, '昔涟：' + iceLink);
    const before = paragraph.toString();
    vm.runInContext(instrumented, result.context);
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
    const result = run(`<div class="comt-main"><p>说明文字<br>下载：${encode(hash)}<br>结束文字</p></div>`);
    const paragraph = result.document.querySelector('p');
    assert.equal(paragraph.innerText, `说明文字\n下载：${link}[复制]\n结束文字`);
    const buttons = paragraph.querySelectorAll('a');
    assert.equal(buttons.length, 1);
    buttons[0].dispatchEvent(new result.window.Event('click', { cancelable: true }));
    await Promise.resolve();
    assert.deepEqual(result.copied, [link]);
});

test('真实故障：包含竺的 URL；支持英文冒号、旧版卜与磁力参数', () => {
    const ed2k = 'ed2k://|file|demo.zip|123|0123456789abcdef0123456789abcdef|/';
    const result = run(`<div class="comt-main"><p>次元W社区？<br>秦魏魏曹金竺姚姚赵戚赵钱薛魏孔曹姚</p>`
        + `<p>下载: ${encode(hash + '&dn=demo.zip')}</p><p>${encode(ed2k).replaceAll('赖', '卜')}</p></div>`);
    const paragraphs = result.document.querySelectorAll('p');
    assert.equal(paragraphs[0].innerText, '次元W社区？\nhttps://0w01.top/[复制]');
    assert.equal(paragraphs[1].innerText, '下载: ' + header + hash + '&dn=demo.zip[复制]');
    assert.equal(paragraphs[2].innerText, ed2k + '[复制]');
});

test('普通姓氏、损坏暗号、错误哈希和协议头均不修改', () => {
    const texts = ['赵钱孙李周吴郑王', '花火：' + encode(hash) + '未知', encode(hash + 'a'),
        encode(hash + 'z'), encode('https:'), encode(header + hash + 'a'), 'https://example.com/'];
    const result = run('<div class="comt-main">' + texts.map((text) => `<p>${text}</p>`).join('') + '</div>');
    Array.from(result.document.querySelectorAll('p')).forEach((paragraph, index) => {
        assert.equal(paragraph.innerText, texts[index]);
        assert.equal(paragraph.dataset.bjxahDecoded, undefined);
        assert.equal(paragraph.querySelector('a'), null);
    });
});

test('重复执行不重复生成按钮，并保留隐藏白字高亮行为', () => {
    const result = run(`<div class="comt-main"><p>${encode(hash)}</p></div>`
        + '<div class="content"><span style="color:#fff">隐藏文字</span><span style="color:red">普通文字</span></div>');
    const before = result.document.toString();
    vm.runInContext(instrumented, result.context);
    assert.equal(result.document.toString(), before);
    assert.equal(result.document.querySelectorAll('p a').length, 1);
    assert.equal(result.document.querySelector('.content span').dataset.bjxahHighlighted, '1');
    assert.equal(result.document.querySelector('.content span:last-child').dataset.bjxahHighlighted, undefined);
});
