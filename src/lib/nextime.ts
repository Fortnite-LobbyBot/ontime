/*
 *  Finds the next time slot
 */

import { norm as fmt } from './fmt.js';

// Define a type for the cycle parameter
type Cycle = 'Y' | 'M' | 'D' | 'w' | 'h' | 'm' | 's' | '';

// Define the nextime function
export default function nextime(cycle: Cycle, s: string, now: Date | null, utc: boolean, last: boolean): Date {
	let offset: number;

	if (utc) {
		offset = new Date().getTimezoneOffset();
	} else {
		offset = 0;
	}

	const mday = (y: number, m: number): number => {
		const daysInMonth = [
			[31, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], // Regular year
			[31, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // Leap year
		];

		const isLeapYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
		return daysInMonth[isLeapYear ? 1 : 0][m];
	};

	const adjust = (): void => {
		switch (cycle) {
			case 'Y':
				sArray[1]++;
				break;
			case 'M':
				sArray[2]++;
				if (sArray[2] > 12) {
					sArray[2] = 1;
					sArray[1]++;
				}
				break;
			case 'D':
				sArray[3]++;
				break;
			case 'w':
				sArray[3] += 7;
				break;
			case 'h':
				sArray[4]++;
				break;
			case 'm':
				sArray[5]++;
				break;
			case 's':
				sArray[6]++;
				break;
		}
	};

	const sArray: any = fmt.exec(s) || ['', NaN, NaN, NaN, NaN, NaN, NaN];

	for (let i = 1; i < sArray.length; i++) {
		sArray[i] = +sArray[i];
	}

	if (
		sArray.length > 0 &&
		(sArray[1] < 1970 ||
			sArray[1] > 9999 ||
			sArray[2] > 12 ||
			sArray[3] > mday(sArray[1] || 4, sArray[2] || 0) ||
			sArray[4] > 23 ||
			sArray[5] > 59 ||
			sArray[6] > 59)
	) {
		throw new Error('Invalid date');
	}

	now = now || new Date();

	// Assign default values for missing time components
	sArray[1] = sArray[1] || now[`get${utc ? 'UTC' : ''}FullYear`]();
	sArray[2] = sArray[2] || now[`get${utc ? 'UTC' : ''}Month`]() + 1;
	sArray[3] = sArray[3] || now[`get${utc ? 'UTC' : ''}Date`]();
	sArray[4] = sArray[4] || now[`get${utc ? 'UTC' : ''}Hours`]();
	sArray[5] = sArray[5] || now[`get${utc ? 'UTC' : ''}Minutes`]();
	sArray[6] = sArray[6] || now[`get${utc ? 'UTC' : ''}Seconds`]();

	let then: Date;

	for (; ;) {
		then = new Date(sArray[1], sArray[2] - 1, sArray[3], sArray[4], sArray[5] - offset, sArray[6], 0);

		if (!then) throw new Error('Invalid date');

		if ((cycle === 'Y' || cycle === 'M') && +then[`get${utc ? 'UTC' : ''}Month`]() !== sArray[2] - 1) {
			if (last) {
				then = new Date(
					sArray[1],
					sArray[2] - 1,
					mday(sArray[1], sArray[2]),
					sArray[4],
					sArray[5] - offset,
					sArray[6],
					0
				);
			} else {
				adjust();
				continue;
			}
		}

		if (cycle && then.valueOf() <= now.valueOf()) {
			adjust();
		} else {
			break;
		}
	}

	return then;
}
