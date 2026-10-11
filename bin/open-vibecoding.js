#!/usr/bin/env node
import { main } from '../src/open-vibecoding.js';

process.exitCode = await main(process.argv.slice(2));
