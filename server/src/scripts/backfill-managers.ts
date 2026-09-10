import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { enrichUserNationalities } from '../sync/enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

// Report missing historical attribution and enrich nationalities of already-known managers.
// Champion owners require dated history evidence; current team ownership is not used here.
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));

const teams = await prisma.leagueChampion.findMany({ where: { OR: [{ championUserId: null }, { championUserId: 0 }] }, distinct: ['championTeamId'], select: { championTeamId: true } });
console.warn(`Historical attribution deferred: ${teams.length} distinct champion team IDs need history evidence. Current-owner inference is disabled; use recover:historical-winners.`);

const pending = await prisma.hattrickUser.count({ where: { nationality: null } });
console.log(`Known-manager nationality pass: ${pending} users need a nationality`);
const n = await enrichUserNationalities(access);
console.log(`Nationality pass: ${n.resolved} resolved, ${n.unknown} unknown, ${n.errors} errors (${n.processed} attempted)`);

const users = await prisma.hattrickUser.count();
const titledChamps = await prisma.leagueChampion.count({ where: { championUserId: { gt: 0 } } });
console.log(`DONE @ ${new Date().toISOString()}: ${users} users, ${titledChamps} titles attributed to a manager`);
await prisma.$disconnect();
