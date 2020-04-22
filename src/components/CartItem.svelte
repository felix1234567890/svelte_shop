<script>
  export let key;
  export let img;
  export let price;
  export let amount;
  export let id;
  export let title;
  import { deleteItem, increaseAmount, decreaseAmount } from "../store.js";
</script>

<div class="cart-item" {key}>
  <img src={img} alt={title} />
  <div>
    <h4>{title}</h4>
    <h4 class="item-price">${price}</h4>
    <button class="remove-btn" on:click={deleteItem.bind(null, id)}>
      remove
    </button>
  </div>
  <div>
    <button class="amount-btn" on:click={increaseAmount.bind(null, id)}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <path
          d="M10.707 7.05L10 6.343 4.343 12l1.414 1.414L10 9.172l4.243
          4.242L15.657 12z" />
      </svg>
    </button>

    <p class="amount">{amount}</p>

    <button
      class="amount-btn"
      on:click={amount === 1 ? deleteItem.bind(null, id) : decreaseAmount.bind(null, id, amount)}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <path
          d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586
          4.343 8z" />
      </svg>
    </button>
  </div>
</div>
