import assert from 'node:assert/strict';
import { bodyToEditorHtml, excerptOf, JOURNAL_IMG_PREFIX, leadImageOf, parseJournalBlocks, readingTimeMinutes, tiptapDocToMarkdown } from './journal';

function test(name: string, fn: () => void) {
  fn();
  console.log('ok  ', name);
}

test('parses headings, quotes, lists, dividers, images, trade embeds, and paragraphs', () => {
  const md = [
    '## Weekly review',
    '',
    'A calm week with **two** clean trades.',
    '',
    '> Never chase a green candle.',
    '> Wait for the retest.',
    '',
    '- Stuck to sizing',
    '- Cut losers fast',
    '',
    `![BTC 4H breakout](${JOURNAL_IMG_PREFIX}uid/img_1.jpg)`,
    '',
    '[[trade:hl:btc-123]]',
    '',
    '---',
    '',
    'Closing thought.',
  ].join('\n');

  const blocks = parseJournalBlocks(md);
  assert.deepEqual(
    blocks.map(b => b.type),
    ['h2', 'p', 'quote', 'list', 'image', 'trade', 'hr', 'p'],
  );
  assert.equal(blocks[0].type === 'h2' && blocks[0].text, 'Weekly review');
  assert.equal(blocks[2].type === 'quote' && blocks[2].text, 'Never chase a green candle.\nWait for the retest.');
  assert.deepEqual(blocks[3].type === 'list' && blocks[3].items, ['Stuck to sizing', 'Cut losers fast']);
  assert.equal(blocks[4].type === 'image' && blocks[4].caption, 'BTC 4H breakout');
  assert.equal(blocks[4].type === 'image' && blocks[4].storagePath, 'uid/img_1.jpg');
  assert.equal(blocks[5].type === 'trade' && blocks[5].tradeId, 'hl:btc-123');
});

test('excerptOf strips markdown, images, and trade embeds cleanly', () => {
  const md = `## Title\n\n![chart](${JOURNAL_IMG_PREFIX}u/a.jpg)\n\n[[trade:t1]]\n\nThis was a **great** lesson in *patience* and \`discipline\`.`;
  assert.equal(excerptOf(md, 120), 'This was a great lesson in patience and discipline.');
});

test('readingTimeMinutes ignores embeds and image syntax', () => {
  const words = Array.from({ length: 410 }, () => 'word').join(' ');
  assert.equal(readingTimeMinutes(words), 2);
  assert.equal(readingTimeMinutes('short note'), 1);
});

test('leadImageOf prefers coverPath and falls back to first inline image', () => {
  assert.deepEqual(leadImageOf({ coverPath: 'u/cover.jpg', body: `![a](${JOURNAL_IMG_PREFIX}u/inline.jpg)` }), {
    src: `${JOURNAL_IMG_PREFIX}u/cover.jpg`,
    storagePath: 'u/cover.jpg',
  });
  assert.deepEqual(leadImageOf({ coverPath: null, body: `Text\n\n![a](${JOURNAL_IMG_PREFIX}u/inline.jpg)` }), {
    src: `${JOURNAL_IMG_PREFIX}u/inline.jpg`,
    storagePath: 'u/inline.jpg',
  });
  assert.equal(leadImageOf({ coverPath: null, body: 'Just text' }), null);
});

test('ordered lists and TipTap HTML/JSON round-trip cleanly', () => {
  const md = `## Plan\n\n1. Wait for retest\n2. Size **calmly**\n\n[[trade:p:123]]`;
  const blocks = parseJournalBlocks(md);
  assert.deepEqual(blocks.map(b => b.type), ['h2', 'ol', 'trade']);
  const html = bodyToEditorHtml(md);
  assert.ok(html.includes('<h2>Plan</h2>'));
  assert.ok(html.includes('<ol><li><p>Wait for retest</p></li><li><p>Size <strong>calmly</strong></p></li></ol>'));
  assert.ok(html.includes('data-journal-trade="p:123"'));

  const back = tiptapDocToMarkdown({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
      {
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wait for retest' }] }] },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Size ' },
                  { type: 'text', text: 'calmly', marks: [{ type: 'bold' }] },
                ],
              },
            ],
          },
        ],
      },
      { type: 'journalTrade', attrs: { tradeId: 'p:123' } },
    ],
  });
  assert.equal(back, md);
});
