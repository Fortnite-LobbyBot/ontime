/*
 *  ontime: a human-readable cron
 */

import { norm, week } from './lib/fmt.js';
import nextime from './lib/nextime.js';

type LogFunction = {
  (msg: string): void;
  cycleString(cycle: string): string;
  timeString(ms: number): string;
};

interface Schedule {
  id?: number;
  cycle?: string | string[];
  step?: number;
  utc?: boolean;
  single?: boolean;
  keepLast?: boolean;
  log?: boolean;
}

type JobFunction = (ot: {
  done(): void;
  cancel(): void;
}) => void;

let idcnt = 0;

function log(id: number, enabled: boolean): LogFunction {
  let r: any;

  if (!enabled) {
    r = () => { };
    r.cycleString = () => '';
    r.timeString = () => '';
    return r as LogFunction;
  }

  const logFunc = (msg: string) => console.log(`[ontime] ${id}: ${msg}`);
  logFunc.cycleString = (cycle: string): string => {
    const descriptions: Record<string, string> = {
      '': 'on specified times',
      s: 'every second',
      m: 'every minute',
      h: 'hourly',
      w: 'weekly',
      D: 'daily',
      M: 'monthly',
      Y: 'yearly'
    };
    return descriptions[cycle] || 'unknown cycle';
  };

  logFunc.timeString = (ms: number): string => {
    ms /= 1000;
    if (ms / (60 * 60 * 24 * 365) >= 1) return `${Math.floor(ms / (60 * 60 * 24 * 365))} year(s)`;
    if (ms / (60 * 60 * 24 * 30) >= 1) return `${Math.floor(ms / (60 * 60 * 24 * 30))} month(s)`;
    if (ms / (60 * 60 * 24 * 7) >= 1) return `${Math.floor(ms / (60 * 60 * 24 * 7))} week(s)`;
    if (ms / (60 * 60 * 24) >= 1) return `${Math.floor(ms / (60 * 60 * 24))} day(s)`;
    if (ms / (60 * 60) >= 1) return `${Math.floor(ms / (60 * 60))} hour(s)`;
    if (ms / 60 >= 1) return `${Math.floor(ms / 60)} min(s)`;
    return `${Math.floor(ms)} sec(s)`;
  };

  return logFunc;
}

function exTimeout(job: () => void, time: number): NodeJS.Timeout {
  const max = 0x7fffffff;

  if (time > max) {
    return setTimeout(() => exTimeout(job, time - max), max);
  }
  return setTimeout(job, time);
}

function convWeekly(days: string[] | string): string[] {
  const dayNumber = (days: string[], i: number, time: string): number => {
    const day = days[i].toLowerCase().substring(0, 3);
    switch (day) {
      case 'sun':
        return 0;
      case 'mon':
        return 1;
      case 'tue':
        return 2;
      case 'wed':
        return 3;
      case 'thu':
        return 4;
      case 'fri':
        return 5;
      case 'sat':
        return 6;
      case 'wee': {
        if (days[i][4] === 'd') {
          // weekday
          days.splice(i, 1, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => `${d} ${time}`));
          return 1;
        } else {
          // weekend
          days.splice(i, 1, ...['Sat', 'Sun'].map((d) => `${d} ${time}`));
          return 6;
        }
      }
      default:
        return 0;
    }
  };

  if (typeof days === 'string') days = [days];
  const base = new Date();

  return days.map((day, i) => {
    const now = new Date(base);
    const timeMatch = /[a-z\s]+(\d{1,2}:\d{1,2}:\d{1,2})$/.exec(day);
    const time = timeMatch ? timeMatch[1] : '00:00:00';
    now.setDate(now.getDate() + ((dayNumber(days, i, time) - now.getDay() + 7) % 7));
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}T${time}`;
  });
}

function getCycle(cycles: string | string[]): string {
  if (typeof cycles === 'string') cycles = [cycles];

  let cycleType: string;
  if (cycles[0] === '') {
    cycleType = 's';
  } else if (week.test(cycles[0])) {
    cycleType = 'w';
  } else {
    const match = norm.exec(cycles[0]);
    if (!match) throw new Error('Invalid cycle description');
    cycleType = match[1] ? '' : match[2] ? 'Y' : match[3] ? 'M' : match[4] ? 'D' : match[5] ? 'h' : 'm';
  }

  for (let i = 1; i < cycles.length; i++) {
    if (cycleType !== getCycle(cycles[i])) {
      throw new Error('Inconsistent cycle description');
    }
  }
  return cycleType;
}

export default function ontime(sched: Schedule, job: JobFunction): void {
  const now = new Date();
  const info = log(sched.id || idcnt++, sched.log ?? false);

  sched.cycle = sched.cycle ?? '';
  if (typeof sched.cycle === 'string') sched.cycle = [sched.cycle];
  sched.step = sched.step ?? 1;

  const cycle = getCycle(sched.cycle);
  if (cycle === 'w') sched.cycle = convWeekly(sched.cycle);
  info(`Job will run ${info.cycleString(cycle)}`);

  if (sched.single) {
    info('Only one instance of job will run');

    const thens: Date[] = [];
    let timer: NodeJS.Timeout | undefined;

    const ready = (current: Date): number => {
      sched.cycle!.forEach((sc: string) => {
        const t = nextime(cycle, sc, current, sched.utc, sched.keepLast);
        if (t.valueOf() > current.valueOf()) thens.push(t);
      });
      thens.sort((a, b) => b.valueOf() - a.valueOf());
      return thens.length;
    };

    const next = () => {
      job({ done: scheduleNext, cancel: cancel });
    };

    const scheduleNext = () => {
      const current = new Date();
      let t: Date | undefined;
      while (thens.length && (t = thens.pop()!) <= current) { }
      if (t) {
        const diff = t.valueOf() - current.valueOf();
        info(`Check for run scheduled after ${info.timeString(diff)} on ${new Date(current.valueOf() + diff)}`);
        timer = exTimeout(next, diff);
      }
    };

    const cancel = () => {
      if (timer) clearTimeout(timer);
    };

    ready(now);
    if (thens.length > 0) {
      const diff = thens.pop()!.valueOf() - now.valueOf();
      if (diff > 0) {
        info(`Job will start after ${info.timeString(diff)} on ${new Date(now.valueOf() + diff)}`);
        timer = exTimeout(next, diff);
      }
    }
  } else {
    info('Multiple instances of job may run');

    const thens: { timer?: NodeJS.Timeout; then: Date; count: number }[] = [];

    sched.cycle.forEach((sc, i) => {
      const next = () => {
        const now = thens[i].then;
        thens[i].then = nextime(cycle, sc, now, sched.utc, sched.keepLast);
        const diff = thens[i].then.valueOf() - now.valueOf();
        if (diff > 0) {
          info(`Check for run scheduled after ${info.timeString(diff)} on ${thens[i].then}`);
          thens[i].timer = exTimeout(next, diff);
        }
        thens[i].count = (thens[i].count + 1) % sched.step!;
        if (thens[i].count === 0) job({ done: () => { }, cancel: () => { } });
        else info(`Will wait for ${sched.step! - thens[i].count} step(s) to run`);
      };

      thens[i] = { then: nextime(cycle, sc, now, sched.utc, sched.keepLast), count: -1 };
      const diff = thens[i].then.valueOf() - now.valueOf();
      if (diff > 0) {
        info(`Job will start after ${info.timeString(diff)} on ${thens[i].then}`);
        thens[i].timer = exTimeout(next, diff);
      }
    });
  }
}
