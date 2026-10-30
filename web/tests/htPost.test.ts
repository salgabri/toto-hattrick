import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htTable, htTeam, htUser } from '../src/aggregate/htPost.ts';

test('tables use a bold header row and one [tr] line per row', () => {
  const post = htTable(['Nazione', 'Utente'], [['Botswana', 'Facundo83 [userid=7185149]'], ['Malta', 'enricobig83']]);
  assert.equal(
    post.markup,
    '[table][tr][td][b]Nazione[/b][/td][td][b]Utente[/b][/td][/tr]\n' +
      '[tr][td]Botswana[/td][td]Facundo83 [userid=7185149][/td][/tr]\n' +
      '[tr][td]Malta[/td][td]enricobig83[/td][/tr][/table]',
  );
  assert.equal(post.rows, 2);
});

test('a table with no rows is just its header', () => {
  assert.deepEqual(htTable(['Season'], []), { markup: '[table][tr][td][b]Season[/b][/td][/tr][/table]', rows: 0 });
});

test('managers and clubs carry their Hattrick id tag only when a real id is known', () => {
  assert.equal(htUser('Mr_Mimmuzzo', 13753823), 'Mr_Mimmuzzo [userid=13753823]');
  assert.equal(htTeam('Parish Saint John', 2137466), 'Parish Saint John [teamid=2137466]');
  assert.equal(htUser('—'), '—');
  assert.equal(htTeam('Li vardasci caraibici de Facundo83', undefined), 'Li vardasci caraibici de Facundo83');
  assert.equal(htTeam('Placeholder', 0), 'Placeholder');
  assert.equal(htUser('Odd', Number.NaN), 'Odd');
});
