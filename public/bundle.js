(function () {
	'use strict';

	/** @returns {void} */
	function noop() {}

	function run(fn) {
		return fn();
	}

	function blank_object() {
		return Object.create(null);
	}

	/**
	 * @param {Function[]} fns
	 * @returns {void}
	 */
	function run_all(fns) {
		fns.forEach(run);
	}

	/**
	 * @param {any} thing
	 * @returns {thing is Function}
	 */
	function is_function(thing) {
		return typeof thing === 'function';
	}

	/** @returns {boolean} */
	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || (a && typeof a === 'object') || typeof a === 'function';
	}

	function subscribe(store, ...callbacks) {
		if (store == null) {
			for (const callback of callbacks) {
				callback(undefined);
			}
			return noop;
		}
		const unsub = store.subscribe(...callbacks);
		return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
	}

	let current_component;

	/** @returns {void} */
	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error('Function called outside component initialization');
		return current_component;
	}

	/**
	 * Schedules a callback to run immediately before the component is unmounted.
	 *
	 * Out of `onMount`, `beforeUpdate`, `afterUpdate` and `onDestroy`, this is the
	 * only one that runs inside a server-side component.
	 *
	 * https://svelte.dev/docs/svelte#ondestroy
	 * @param {() => any} fn
	 * @returns {void}
	 */
	function onDestroy(fn) {
		get_current_component().$$.on_destroy.push(fn);
	}

	// general each functions:

	function ensure_array_like(array_like_or_iterator) {
		return array_like_or_iterator?.length !== undefined
			? array_like_or_iterator
			: Array.from(array_like_or_iterator);
	}

	const ATTR_REGEX = /[&"]/g;
	const CONTENT_REGEX = /[&<]/g;

	/**
	 * Note: this method is performance sensitive and has been optimized
	 * https://github.com/sveltejs/svelte/pull/5701
	 * @param {unknown} value
	 * @returns {string}
	 */
	function escape(value, is_attr = false) {
		const str = String(value);
		const pattern = is_attr ? ATTR_REGEX : CONTENT_REGEX;
		pattern.lastIndex = 0;
		let escaped = '';
		let last = 0;
		while (pattern.test(str)) {
			const i = pattern.lastIndex - 1;
			const ch = str[i];
			escaped += str.substring(last, i) + (ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : '&lt;');
			last = i + 1;
		}
		return escaped + str.substring(last);
	}

	/** @returns {string} */
	function each(items, fn) {
		items = ensure_array_like(items);
		let str = '';
		for (let i = 0; i < items.length; i += 1) {
			str += fn(items[i], i);
		}
		return str;
	}

	function validate_component(component, name) {
		if (!component || !component.$$render) {
			if (name === 'svelte:component') name += ' this={...}';
			throw new Error(
				`<${name}> is not a valid SSR component. You may need to review your build config to ensure that dependencies are compiled, rather than imported as pre-compiled modules. Otherwise you may need to fix a <${name}>.`
			);
		}
		return component;
	}

	let on_destroy;

	/** @returns {{ render: (props?: {}, { $$slots, context }?: { $$slots?: {}; context?: Map<any, any>; }) => { html: any; css: { code: string; map: any; }; head: string; }; $$render: (result: any, props: any, bindings: any, slots: any, context: any) => any; }} */
	function create_ssr_component(fn) {
		function $$render(result, props, bindings, slots, context) {
			const parent_component = current_component;
			const $$ = {
				on_destroy,
				context: new Map(context || (parent_component ? parent_component.$$.context : [])),
				// these will be immediately discarded
				on_mount: [],
				before_update: [],
				after_update: [],
				callbacks: blank_object()
			};
			set_current_component({ $$ });
			const html = fn(result, props, bindings, slots);
			set_current_component(parent_component);
			return html;
		}
		return {
			render: (props = {}, { $$slots = {}, context = new Map() } = {}) => {
				on_destroy = [];
				const result = { title: '', head: '', css: new Set() };
				const html = $$render(result, props, {}, $$slots, context);
				run_all(on_destroy);
				return {
					html,
					css: {
						code: Array.from(result.css)
							.map((css) => css.code)
							.join('\n'),
						map: null // TODO
					},
					head: result.title + result.head
				};
			},
			$$render
		};
	}

	/** @returns {string} */
	function add_attribute(name, value, boolean) {
		if (value == null || (boolean && !value)) return '';
		const assignment = boolean && value === true ? '' : `="${escape(value, true)}"`;
		return ` ${name}${assignment}`;
	}

	const subscriber_queue = [];

	/**
	 * Creates a `Readable` store that allows reading by subscription.
	 *
	 * https://svelte.dev/docs/svelte-store#readable
	 * @template T
	 * @param {T} [value] initial value
	 * @param {import('./public.js').StartStopNotifier<T>} [start]
	 * @returns {import('./public.js').Readable<T>}
	 */
	function readable(value, start) {
		return {
			subscribe: writable(value, start).subscribe
		};
	}

	/**
	 * Create a `Writable` store that allows both updating and reading by subscription.
	 *
	 * https://svelte.dev/docs/svelte-store#writable
	 * @template T
	 * @param {T} [value] initial value
	 * @param {import('./public.js').StartStopNotifier<T>} [start]
	 * @returns {import('./public.js').Writable<T>}
	 */
	function writable(value, start = noop) {
		/** @type {import('./public.js').Unsubscriber} */
		let stop;
		/** @type {Set<import('./private.js').SubscribeInvalidateTuple<T>>} */
		const subscribers = new Set();
		/** @param {T} new_value
		 * @returns {void}
		 */
		function set(new_value) {
			if (safe_not_equal(value, new_value)) {
				value = new_value;
				if (stop) {
					// store is ready
					const run_queue = !subscriber_queue.length;
					for (const subscriber of subscribers) {
						subscriber[1]();
						subscriber_queue.push(subscriber, value);
					}
					if (run_queue) {
						for (let i = 0; i < subscriber_queue.length; i += 2) {
							subscriber_queue[i][0](subscriber_queue[i + 1]);
						}
						subscriber_queue.length = 0;
					}
				}
			}
		}

		/**
		 * @param {import('./public.js').Updater<T>} fn
		 * @returns {void}
		 */
		function update(fn) {
			set(fn(value));
		}

		/**
		 * @param {import('./public.js').Subscriber<T>} run
		 * @param {import('./private.js').Invalidator<T>} [invalidate]
		 * @returns {import('./public.js').Unsubscriber}
		 */
		function subscribe(run, invalidate = noop) {
			/** @type {import('./private.js').SubscribeInvalidateTuple<T>} */
			const subscriber = [run, invalidate];
			subscribers.add(subscriber);
			if (subscribers.size === 1) {
				stop = start(set, update) || noop;
			}
			run(value);
			return () => {
				subscribers.delete(subscriber);
				if (subscribers.size === 0 && stop) {
					stop();
					stop = null;
				}
			};
		}
		return { set, update, subscribe };
	}

	/**
	 * Derived value store by synchronizing one or more readable stores and
	 * applying an aggregation function over its input values.
	 *
	 * https://svelte.dev/docs/svelte-store#derived
	 * @template {import('./private.js').Stores} S
	 * @template T
	 * @overload
	 * @param {S} stores - input stores
	 * @param {(values: import('./private.js').StoresValues<S>, set: (value: T) => void, update: (fn: import('./public.js').Updater<T>) => void) => import('./public.js').Unsubscriber | void} fn - function callback that aggregates the values
	 * @param {T} [initial_value] - initial value
	 * @returns {import('./public.js').Readable<T>}
	 */

	/**
	 * Derived value store by synchronizing one or more readable stores and
	 * applying an aggregation function over its input values.
	 *
	 * https://svelte.dev/docs/svelte-store#derived
	 * @template {import('./private.js').Stores} S
	 * @template T
	 * @overload
	 * @param {S} stores - input stores
	 * @param {(values: import('./private.js').StoresValues<S>) => T} fn - function callback that aggregates the values
	 * @param {T} [initial_value] - initial value
	 * @returns {import('./public.js').Readable<T>}
	 */

	/**
	 * @template {import('./private.js').Stores} S
	 * @template T
	 * @param {S} stores
	 * @param {Function} fn
	 * @param {T} [initial_value]
	 * @returns {import('./public.js').Readable<T>}
	 */
	function derived(stores, fn, initial_value) {
		const single = !Array.isArray(stores);
		/** @type {Array<import('./public.js').Readable<any>>} */
		const stores_array = single ? [stores] : stores;
		if (!stores_array.every(Boolean)) {
			throw new Error('derived() expects stores as input, got a falsy value');
		}
		const auto = fn.length < 2;
		return readable(initial_value, (set, update) => {
			let started = false;
			const values = [];
			let pending = 0;
			let cleanup = noop;
			const sync = () => {
				if (pending) {
					return;
				}
				cleanup();
				const result = fn(single ? values[0] : values, set, update);
				if (auto) {
					set(result);
				} else {
					cleanup = is_function(result) ? result : noop;
				}
			};
			const unsubscribers = stores_array.map((store, i) =>
				subscribe(
					store,
					(value) => {
						values[i] = value;
						pending &= ~(1 << i);
						if (started) {
							sync();
						}
					},
					() => {
						pending |= 1 << i;
					}
				)
			);
			started = true;
			sync();
			return function stop() {
				run_all(unsubscribers);
				cleanup();
				// We need to set this to false because callbacks can still happen despite having unsubscribed:
				// Callbacks might already be placed in the queue which doesn't know it should no longer
				// invoke this derived store.
				started = false;
			};
		});
	}

	var cartItems = [
	  {
	    id: 1,
	    title: "Samsung Galaxy S7",
	    price: 599.99,
	    img:
	      "https://res.cloudinary.com/diqqf3eq2/image/upload/v1583368215/phone-2_ohtt5s.png",
	    amount: 1
	  },
	  {
	    id: 2,
	    title: "google pixel ",
	    price: 499.99,
	    img:
	      "https://res.cloudinary.com/diqqf3eq2/image/upload/v1583371867/phone-1_gvesln.png",
	    amount: 1
	  },
	  {
	    id: 3,
	    title: "Xiaomi Redmi Note 2",
	    price: 699.99,
	    img:
	      "https://res.cloudinary.com/diqqf3eq2/image/upload/v1583368224/phone-3_h2s6fo.png",
	    amount: 1
	  }
	];

	const store = writable({
	  cart: cartItems,
	});

	const amount = derived(store, ({ amount }) => {
	  let cart;
	  store.subscribe((value) => (cart = value.cart));
	  const amt = cart.reduce((amt, cartItem) => {
	    const { amount } = cartItem;
	    amt += amount;
	    return amt;
	  }, 0);
	  return amt;
	});

	const total = derived(store, ({ total }) => {
	  let cart;
	  store.subscribe((value) => (cart = value.cart));
	  const tot = cart.reduce((tot, cartItem) => {
	    const { price, amount } = cartItem;
	    const itemTotal = price * amount;
	    tot += itemTotal;
	    tot = parseFloat(tot.toFixed(2));
	    return tot;
	  }, 0);
	  return tot;
	});

	/* src/components/Navbar.svelte generated by Svelte v4.2.0 */

	const Navbar = create_ssr_component(($$result, $$props, $$bindings, slots) => {
		let $amount, $$unsubscribe_amount;
		$$unsubscribe_amount = subscribe(amount, value => $amount = value);
		$$unsubscribe_amount();

		return `<nav><div class="nav-center"><h3 data-svelte-h="svelte-1bgin9c">Shop</h3> <div class="nav-container"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M16 6v2h2l2 12H0L2 8h2V6a6 6 0 1 1 12 0zm-2 0a4 4 0 1 0-8
          0v2h8V6zM4 10v2h2v-2H4zm10 0v2h2v-2h-2z"></path></svg> <div class="amount-container"><p class="total-amount">${escape($amount)}</p></div></div></div></nav>`;
	});

	/* src/components/CartItem.svelte generated by Svelte v4.2.0 */

	const CartItem = create_ssr_component(($$result, $$props, $$bindings, slots) => {
		let { key } = $$props;
		let { img } = $$props;
		let { price } = $$props;
		let { amount } = $$props;
		let { id } = $$props;
		let { title } = $$props;
		if ($$props.key === void 0 && $$bindings.key && key !== void 0) $$bindings.key(key);
		if ($$props.img === void 0 && $$bindings.img && img !== void 0) $$bindings.img(img);
		if ($$props.price === void 0 && $$bindings.price && price !== void 0) $$bindings.price(price);
		if ($$props.amount === void 0 && $$bindings.amount && amount !== void 0) $$bindings.amount(amount);
		if ($$props.id === void 0 && $$bindings.id && id !== void 0) $$bindings.id(id);
		if ($$props.title === void 0 && $$bindings.title && title !== void 0) $$bindings.title(title);

		return `<div class="cart-item"${add_attribute("key", key, 0)}><img${add_attribute("src", img, 0)}${add_attribute("alt", title, 0)}> <div><h4>${escape(title)}</h4> <h4 class="item-price">$${escape(price)}</h4> <button class="remove-btn" data-svelte-h="svelte-1n36068">remove</button></div> <div><button class="amount-btn" data-svelte-h="svelte-1kwlo1z"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M10.707 7.05L10 6.343 4.343 12l1.414 1.414L10 9.172l4.243
          4.242L15.657 12z"></path></svg></button> <p class="amount">${escape(amount)}</p> <button class="amount-btn" data-svelte-h="svelte-b577no"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586
          4.343 8z"></path></svg></button></div></div>`;
	});

	/* src/components/CartContainer.svelte generated by Svelte v4.2.0 */

	const CartContainer = create_ssr_component(($$result, $$props, $$bindings, slots) => {
		let $total, $$unsubscribe_total;
		$$unsubscribe_total = subscribe(total, value => $total = value);
		let cart;

		const unsubscribe = store.subscribe(value => {
			cart = value.cart;
		});

		onDestroy(unsubscribe);
		$$unsubscribe_total();

		return `${cart.length === 0
	? `<section class="cart" data-svelte-h="svelte-mfoqzb"><header><h2>your bag</h2> <h4 class="empty-cart">is currently empty</h4></header></section>`
	: `<section class="cart"><header data-svelte-h="svelte-15h53ei"><h2>your bag</h2></header> <article>${each(cart, (item, i) => {
			return `${validate_component(CartItem, "CartItem").$$render($$result, Object.assign({}, { key: i }, item), {}, {})}`;
		})}</article> <footer><hr> <div class="cart-total"><h4>total
          <span>$${escape($total)}</span></h4></div> <button class="btn clear-btn" data-svelte-h="svelte-1nlc80f">clear cart</button></footer></section>`}`;
	});

	/* src/App.svelte generated by Svelte v4.2.0 */

	const App = create_ssr_component(($$result, $$props, $$bindings, slots) => {
		return `<main>${validate_component(Navbar, "Navbar").$$render($$result, {}, {}, {})} ${validate_component(CartContainer, "CartContainer").$$render($$result, {}, {}, {})}</main>`;
	});

	const app = new App({
	  target: document.body
	});

	return app;

})();
