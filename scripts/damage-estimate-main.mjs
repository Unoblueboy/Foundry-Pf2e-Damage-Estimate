const moduleId = 'pf2e-damage-estimate';

const persistentDamageIcon = 'fa-hourglass';
const bleedDamageIcon = 'fa-droplet';
const persistentDamageSuffix = `<i class="fa-duotone ${persistentDamageIcon}">`;

const precisionDamageClassName = 'precision';
const precisionDamageIcon = 'fa-crosshairs';

const onlyGmSetting = 'onlyGmSetting'
const estimateTypeSetting = 'estimateTypeSetting';
const ESTIMATE_TYPE = {
	NONE: 0,
	ONLY_AVERAGE: 1,
	ONLY_RANGE: 2,
	AVERAGE_AND_RANGE: 3
};
Hooks.on('init', () => {
	game.settings.register(moduleId, onlyGmSetting, {
		name: 'Only GM',
		hint: 'If true, only the GM will see the estimated damage. Otherwise, all players will see it.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false
	});
	
	game.settings.register(moduleId, estimateTypeSetting, {
		name: 'Estimate type',
		hint: 'Estimate might be globally disabled by GM.',
		scope: 'client',
		config: true,
		type: Number,
		choices: {
			[ESTIMATE_TYPE.NONE]: 'Estimate disabled',
			[ESTIMATE_TYPE.ONLY_AVERAGE]: 'Show only average damage',
			[ESTIMATE_TYPE.ONLY_RANGE]: 'Show only damage range',
			[ESTIMATE_TYPE.AVERAGE_AND_RANGE]: 'Show average damage and damage range'
		},
		default: ESTIMATE_TYPE.AVERAGE_AND_RANGE
	})
});

Hooks.on('renderDamageModifierDialog', (dialogInfo, init, data) => {
	// Not a GM but only GM can see the estimate
	if(game.settings.get(moduleId, onlyGmSetting) && !isLoggedUserGamemaster()) {
		return;
	}

	// Estimate is locally disabled
	if(game.settings.get(moduleId, estimateTypeSetting) === ESTIMATE_TYPE.NONE) {
		return;
	}
		
	const appId = data.appId;
	const dialog = document.querySelector('div#' + appId);
	
	// Since window is too small, we have to make it bigger; its height is in px so we just expand it
	let dialogHeightInPx = parseInt(dialog.style.height);
	dialogHeightInPx += 44;
	dialog.style.height = dialogHeightInPx + 'px';
	
	const formulaButton = dialog.querySelector('button.roll');
	
	const damage = getDamage(data);
	const appendString = getEstimateHtmlString(damage);
	
	formulaButton.innerHTML += appendString;
});

const dieRegex = /(\d+)d(\d+)/g;
function getDamage(data) {
	let formula = data.formula;

	// Remove precision damage related tags
	let formulaDiv = document.createElement('div');
	formulaDiv.innerHTML = formula;
	
	let precisionSpans = formulaDiv.querySelectorAll(`span.${precisionDamageClassName}`);
	precisionSpans.forEach(span => {
		const spanInnerHTML = span.innerHTML;
		const spanOuterHTML = span.outerHTML;
		formulaDiv.innerHTML = formulaDiv.innerHTML.replace(spanOuterHTML, spanInnerHTML);
	})

	let precisionIcons = formulaDiv.querySelectorAll(`i.${precisionDamageIcon}`);
	precisionIcons.forEach(icon => icon.remove());

	formula = formulaDiv.innerHTML;
	formulaDiv.remove();
	//--

	const splittedFormula = formula.split('</span>');

	const extractedFormulas = splittedFormula.map((singleFormula) => {
		const endOfFirstTag = singleFormula.indexOf('>');
		let startOfSecondTag = singleFormula.indexOf('<', endOfFirstTag + 1);

		if(endOfFirstTag === -1)
			return undefined;

		if(startOfSecondTag === -1)
			startOfSecondTag = singleFormula.length; // Untyped damage don't have second tag

		const extractedFormula = singleFormula.substring(endOfFirstTag + 1, startOfSecondTag).trim();
		const minDamageFormula = extractedFormula.replace(dieRegex, '($1)');
		const maxDamageFormula = extractedFormula.replace(dieRegex, '($1 * $2)');
		const isPersistent = singleFormula.includes(persistentDamageIcon) || singleFormula.includes(bleedDamageIcon);

		return {
			formula: extractedFormula,

			minDamageFormula: minDamageFormula,
			minDamage: calculate(minDamageFormula),

			maxDamageFormula: maxDamageFormula,
			maxDamage: calculate(maxDamageFormula),

			isPersistent: isPersistent
		}
	}).filter(item => item);

	const damageSum = extractedFormulas.reduce((acc, value) => {
		if(value.isPersistent) {
			return {
				min: acc.min,
				max: acc.max,
				persistent: true,
				minPersistent: acc.minPersistent + value.minDamage,
				maxPersistent: acc.maxPersistent + value.maxDamage
			}
		}
		else {
			return {
				min: acc.min + value.minDamage,
				max: acc.max + value.maxDamage,
				persistent: acc.persistent,
				minPersistent: acc.minPersistent,
				maxPersistent: acc.maxPersistent
			}
		}
	}, {
		min: 0,
		max: 0,
		persistent: false,
		minPersistent: 0,
		maxPersistent: 0
	});

	return damageSum;
}

function getEstimateHtmlString(damage) {
	const stringType = game.settings.get(moduleId, estimateTypeSetting);

	let innerDamageString = getDamageString(damage.min, damage.max, stringType);
	if (damage.persistent) {
		innerDamageString += ` + ${getDamageString(damage.minPersistent, damage.maxPersistent, stringType)} ${persistentDamageSuffix}`;
	}

	const hrBeforeSpanString = `<hr style="width:80%; opacity:0.5; margin:0.5em auto">`;
	const spanString = `<span class="damage instance color">${innerDamageString}</span>`;
	
	return hrBeforeSpanString + spanString;
}

function getDamageString(minDamage, maxDamage, stringType) {
	const avgDamage = Math.round( (minDamage + maxDamage) / 2 * 10 ) / 10;

	if(stringType == ESTIMATE_TYPE.ONLY_AVERAGE) {
		return avgDamage.toString();
	}

	if(stringType == ESTIMATE_TYPE.ONLY_RANGE) {
		return `${minDamage}~${maxDamage}`;
	}

	// stringType == ESTIMATE_TYPE.AVERAGE_AND_RANGE or unexpected options
	return `${avgDamage} (${minDamage}~${maxDamage})`;
}


function calculate(expr) {
	expr = expr.replace(/\s/g, '');
	return calculate_helper(Array.from(expr), 0);
}

function isLoggedUserGamemaster() {
	return !!game.users.get(game.userId).isGM;
}
// Based on https://medium.com/@tommypang04/a-simple-calculator-that-evaluates-elementary-arithmetic-expressions-with-javascript-bca12de61aea
function calculate_helper(s, idx) {
	var stk = [];
	let sign = '+';
	let num = 0;
	
	for (let i = idx; i < s.length; i++) {
	  let c = s[i];
	  if (c >= '0' && c <= '9') {
		num = num * 10 + (c - '0');
	  }
	  if (!(c >= '0' && c <= '9') || i===s.length-1) {
		if (c==='(') {
		  num = calculate_helper(s, i+1);
		  let l = 1, r = 0;
		  for (let j = i+1; j < s.length; j++) {
			if (s[j]===')') {
			  r++;
			  if (r===l) {
				i=j; break;
			  }
			}
			else if (s[j]==='(') l++;
		  }
		}
		let pre = -1;
		switch (sign) {
		  case '+':
			stk.push(num);
			break;
		  case '-':
			stk.push(num*-1);
			break;
		  case '*':
			pre = stk.pop();
			stk.push(pre*num);
			break;
		  case '/':
			pre = stk.pop();
			stk.push(pre/num);
			break;
		}
		sign = c;
		num = 0;
		if (c===')') break;
	  }
	}
	
	let ans = 0;
	
	while (stk.length > 0) {
	  ans += stk.pop();
	}
	
	return ans;
}
