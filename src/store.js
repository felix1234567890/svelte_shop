import { writable, derived } from "svelte/store";
import cartItems from "./cart-items.js";

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

const reset = () => {
  store.set({
    cart: [],
  });
};

const deleteItem = (id) => {
  store.update((value) => {
    const ind = value.cart.findIndex((item) => item.id == id);
    value.cart.splice(ind, 1);
    return value;
  });
};

const increaseAmount = (id) => {
  store.update((value) => {
    const newCart = value.cart.map((item) => {
      if (item.id == id) {
        item = { ...item, amount: item.amount + 1 };
      }
      return item;
    });
    value.cart = newCart;
    return value;
  });
};
const decreaseAmount = (id, amount) => {
  store.update((value) => {
    const newCart = value.cart.map((item) => {
      if (item.id === id) {
        item = { ...item, amount: item.amount - 1 };
      }
      return item;
    });
    value.cart = newCart;
    return value;
  });
};

export {
  store,
  reset,
  deleteItem,
  increaseAmount,
  decreaseAmount,
  amount,
  total,
};
