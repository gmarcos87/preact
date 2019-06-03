import { Component, createElement, unmount } from 'preact';
import { removeNode } from '../../src/util';

export function catchRender(error, component) {
	// thrown Promises are meant to suspend...
	if (error.then) {
		for (let vnode = component._vnode; vnode; vnode = vnode._parent) {
			if ((component = vnode._component) && component._childDidSuspend) {
				component._childDidSuspend(error);
				return true;
			}
		}
	}

	return false;
}

function removeDom(vnode) {
	let tmp = vnode._component;
	if (tmp != null) {
		if (tmp = tmp._prevVNode) removeDom(tmp);
	}
	else if ((tmp = vnode._children) && vnode._lastDomChild) {
		for (let i = 0; i < tmp.length; i++) {
			if (tmp[i]) removeDom(tmp[i]);
		}
	}

	if (tmp = vnode._dom) {
		removeNode(tmp);
	}
}

// having custom inheritance instead of a class here saves a lot of bytes
export function Suspense(props) {
	// we do not call super here to golf some bytes...
	this._suspensions = [];
}

// Things we do here to save some bytes but are not proper JS inheritance:
// - call `new Component()` as the prototype
// - do not set `Suspense.prototype.constructor` to `Suspense`
Suspense.prototype = new Component();

/**
 * @param {Promise} promise The thrown promise
 */
Suspense.prototype._childDidSuspend = function(promise) {
	// saves 5B
	const _this = this;

	_this._suspensions.push(promise);
	let len = _this._suspensions.length;

	const suspensionsCompleted = () => {
		// make sure we did not add any more suspensions
		if (len === _this._suspensions.length) {
			// clear old suspensions
			_this._suspensions = [];

			// remove fallback
			unmount(_this.props.fallback);

			// make preact think we had mounted the _parkedVNode previously...
			_this._prevVNode = _this._parkedVNode;
			// reset the timeout & clear the now no longer parked vnode
			_this._timeout = _this._parkedVNode = null;

			_this.forceUpdate();
		}
	};

	const timeoutOrSuspensionsCompleted = () => {
		if (_this._timeoutCompleted && _this._suspensions.length && !_this._parkedVNode) {
			// park old vnode & remove dom
			removeDom(_this._parkedVNode = _this._prevVNode);
			_this._prevVNode = null;

			// render and mount fallback
			_this.forceUpdate();
		}
	};

	if (!_this._timeout) {
		_this._timeoutCompleted = false;

		_this._timeout = (
			_this.props.maxDuration
				? new Promise((res) => {
					setTimeout(res, _this.props.maxDuration);
				})
				// even tough there is not maxDuration configured we will defer the suspension
				// as we want the rendering/diffing to finish as it might yield other suspensions
				: Promise.resolve()
		)
			.then(() => {
				_this._timeoutCompleted = true;
			});
	}

	// __test__suspensions_timeout_race is assigned here to let tests await _this...
	_this.__test__suspensions_timeout_race = Promise.race([
		_this._timeout,
		// Suspense ignores errors thrown in Promises as _this should be handled by user land code
		Promise.all(_this._suspensions).then(suspensionsCompleted, suspensionsCompleted)
	])
		.then(timeoutOrSuspensionsCompleted);
};

Suspense.prototype.render = function(props, state) {
	// When _parkedVNode is set, we are in suspension state
	return this._parkedVNode ? props.fallback : props.children;
};

export function lazy(loader) {
	let prom;
	let component;
	let error;

	function Lazy(props) {
		if (!prom) {
			prom = loader();
			prom.then(
				(exports) => { component = exports.default; },
				(e) => { error = e; },
			);
		}

		if (error) {
			throw error;
		}

		if (!component) {
			throw prom;
		}

		return createElement(component, props);
	}

	Lazy.displayName = 'Lazy';

	return Lazy;
}
