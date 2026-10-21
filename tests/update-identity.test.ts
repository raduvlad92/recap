import { describe, expect, it } from 'vitest';
import { updateIdentity } from '../src/lib/domain';
import type { Creator, Source, SourceUpdate } from '../src/lib/types';
const studio: Creator = { id:'studio',name:'Example Studio',kind:'studio',handle:'@studio',bio:'Test identity.',color:'#bedacf',initials:'ES',sourceIds:['main','lab'] };
const person: Creator = { id:'presenter',name:'Example Presenter',kind:'person',handle:'@presenter',bio:'Test identity.',color:'#bedacf',initials:'EP',sourceIds:['main','lab'] };
const sources: Source[] = [
  { id:'main',name:'Main Channel',url:'https://example.org/main',platform:'YouTube',creatorIds:[studio.id],status:'ready' },
  { id:'lab',name:'Lab Channel',url:'https://example.org/lab',platform:'YouTube',creatorIds:[studio.id],status:'ready' },
];
const update: SourceUpdate = { id:'item',sourceId:'main',contributorIds:[],title:'Test update',summary:'Test source material.',url:'https://example.org/item',publishedAt:'2026-10-21T10:00:00.000Z',format:'video',topics:[],brands:[],sponsors:[],references:[],insights:[],isSample:false };

describe('channel identity and genuine contributor credit', () => {
  it('distinguishes two studio channels rather than replacing both bylines with the studio', () => {
    const main=updateIdentity(update,sources,[studio,person]);
    const lab=updateIdentity({...update,sourceId:'lab'},sources,[studio,person]);
    expect([main.name,lab.name]).toEqual(['Main Channel','Lab Channel']);
    expect(main.publisher).toBe(studio);expect(lab.publisher).toBe(studio);
    expect(main.contributor).toBeUndefined();expect(lab.contributor).toBeUndefined();
    expect(main.source?.id).toBe('main');expect(lab.source?.id).toBe('lab');
  });
  it('preserves an explicit known presenter credit while retaining the actual channel destination', () => {
    const credited=updateIdentity({...update,contributorIds:[person.id]},sources,[studio,person]);
    expect(credited.name).toBe(person.name);expect(credited.contributor).toBe(person);
    expect(credited.source).toBe(sources[0]);expect(credited.publisher).toBe(studio);
  });
  it('uses the first known explicit contributor, never a guessed presenter from shared channels', () => {
    expect(updateIdentity({...update,contributorIds:['unresolved',person.id]},sources,[studio,person]).contributor).toBe(person);
    const unresolved=updateIdentity({...update,contributorIds:['unresolved']},sources,[studio,person]);
    expect(unresolved.name).toBe('Main Channel');expect(unresolved.contributor).toBeUndefined();
  });
  it('does not infer a publisher from a presenter’s associated channels when the source names no publisher', () => {
    const identity=updateIdentity(update,[{...sources[0],creatorIds:[]}],[person]);
    expect(identity.name).toBe('Main Channel');expect(identity.publisher).toBeUndefined();expect(identity.contributor).toBeUndefined();
  });
  it('keeps an explicit credit even if the original source is missing, and otherwise reports an unknown source', () => {
    expect(updateIdentity({...update,contributorIds:[person.id]},[],[person]).name).toBe(person.name);
    expect(updateIdentity(update,[],[studio,person])).toMatchObject({name:'Unknown source',contributor:undefined,publisher:undefined});
  });
});
