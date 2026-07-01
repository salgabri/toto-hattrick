import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { enrichChampionManagers, enrichUserNationalities } from '../sync/enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

// Resolve champion managers + nationalities. Resume-safe (re-run to continue).
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));

const teams = await prisma.leagueChampion.findMany({ where: { championUserId: null }, distinct: ['championTeamId'], select: { championTeamId: true } });
console.log(`PASS 1: ${teams.length} distinct champion teams to resolve @ ${new Date().toISOString()}`);
const m = await enrichChampionManagers(access);
console.log(`pass 1 done: ${m.processed} teams, ${m.resolved} resolved to a manager`);

const pending = await prisma.hattrickUser.count({ where: { nationality: null } });
console.log(`PASS 2: ${pending} users need a nationality`);
const n = await enrichUserNationalities(access);
console.log(`pass 2 done: ${n.processed} users`);

const users = await prisma.hattrickUser.count();
const titledChamps = await prisma.leagueChampion.count({ where: { championUserId: { gt: 0 } } });
console.log(`DONE @ ${new Date().toISOString()}: ${users} users, ${titledChamps} titles attributed to a manager`);
await prisma.$disconnect();
