<script>
  import CartItem from "./CartItem.svelte";
  import { store, reset, total } from "../store.js";
  import { onDestroy } from "svelte";

  let cart;
  const unsubscribe = store.subscribe(value => {
    cart = value.cart;
  });
  onDestroy(unsubscribe);
</script>

{#if cart.length === 0}
  <section class="cart">
    <header>
      <h2>your bag</h2>
      <h4 class="empty-cart">is currently empty</h4>
    </header>
  </section>
{:else}
  <section class="cart">
    <header>
      <h2>your bag</h2>
    </header>
    <article>
      {#each cart as item, i}
        <CartItem key={i} {...item} />
      {/each}
    </article>
    <footer>
      <hr />
      <div class="cart-total">
        <h4>
          total
          <span>${$total}</span>
        </h4>
      </div>
      <button class="btn clear-btn" on:click={reset}>clear cart</button>
    </footer>
  </section>
{/if}
