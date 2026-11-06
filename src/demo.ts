namespace Fedi {
  export const demoMe: Account = {
    id: "you",
    name: "Your corner",
    acct: "you@fedistack.local",
    avatar: "",
    bio: "A reader, a writer, a person on the open web.",
    color: "terracotta",
  };
  export const demoAuthors: Account[] = [
    {
      id: "mara",
      name: "Mara Wilson",
      acct: "mara@writing.exchange",
      publication: "The Sunday Internet",
      avatar: "",
      bio: "Notes on a slower, more human internet.",
      color: "sage",
    },
    {
      id: "elliot",
      name: "Elliot Park",
      acct: "elliot@design.social",
      publication: "Common Ground",
      avatar: "",
      bio: "Design, cities, and the spaces in between.",
      color: "sand",
    },
    {
      id: "ines",
      name: "Inés García",
      acct: "ines@writing.exchange",
      publication: "Outside, Again",
      avatar: "",
      bio: "A field guide to paying attention.",
      color: "rose",
    },
    {
      id: "sam",
      name: "Sam Okafor",
      acct: "sam@smallweb.social",
      publication: "Small Hours",
      avatar: "",
      bio: "Making things. Leaving room for wonder.",
      color: "lavender",
    },
  ];
  const ago = (hours: number) =>
    new Date(Date.now() - hours * 3600000).toISOString();
  function demoPost(
    id: string,
    author: Account,
    title: string,
    subtitle: string,
    body: string,
    hours: number,
    image?: string,
    tags = ["Culture"],
  ): Post {
    return {
      id,
      author,
      title,
      subtitle,
      markdown: body,
      kind: title ? "article" : "post",
      created: ago(hours),
      image,
      imageAlt: title,
      likes: 24,
      replies: 2,
      reposts: 0,
      liked: false,
      reposted: false,
      saved: false,
      visibility: "public",
      warning: "",
      tags,
      language: "en",
      local: author.acct.endsWith("writing.exchange"),
    };
  }
  export const demoPosts: Post[] = [
    demoPost(
      "slow-web",
      demoAuthors[0],
      "The internet can still be a place we go to feel human.",
      "On small websites, slow conversations, and finding our way back to each other.",
      `There is a particular kind of quiet you find on a personal website. No trending sidebar. No countdown. Just someone who has put a little of themselves into a corner of the internet and left the door open.

I have been thinking about that quiet a lot lately.

## A smaller kind of connection

Last Sunday, I found a blog about repairing old radios. Its author had been writing there for eleven years. Each entry ended with a photograph of the workbench, a cup of tea, and a note about what went wrong.

I read for an hour. Then I wrote him a message. The next morning, he replied.

> Maybe the internet we miss is not a place we need to return to. Maybe it is a practice we can begin again.

We tend to talk about the web as something that happens to us. The feed changes. A platform closes. An algorithm decides. But there is another version of the story, and it begins with the things we choose to make.

## Leave a little room

A good conversation needs room. So does a good essay. Neither thrives when every pause is a chance for something else to interrupt.

Here are a few small practices I am trying:

- Read one person's archive instead of refreshing a feed.
- Leave a thoughtful reply when a piece stays with me.
- Share a link with a friend, with a sentence about why.
- Write something without asking whether it will travel.

The open web gives us the tools to do all of this. Independent servers can talk to one another. Our writing can reach people without asking them to join the same company. We can build something small and still be connected.

## A door, left open

This is not nostalgia for a perfect internet. There never was one. It is an invitation to notice the good parts that are still here, quietly doing their work.

Someone is writing about their garden. Someone is documenting a language. Someone is fixing a radio and making a second cup of tea.

We can visit. We can reply. We can leave our own door open.`,
      2,
      "assets/slow-web.svg",
      ["Technology", "Culture"],
    ),
    demoPost(
      "cities",
      demoAuthors[1],
      "What makes a place worth staying in?",
      "A case for the ordinary spaces that bring us together.",
      `The best room in my neighborhood has no walls. It is a little square between the bakery and the library, with three benches and a tree that makes an admirable attempt at shade.

## Designed for being, not buying

Good public spaces make a quiet promise: **you are allowed to be here**. You do not have to buy anything, explain yourself, or be on your way somewhere else.

> The measure of a city is how easily a person can belong to it.

This is as true of our digital spaces as it is of our streets. We need places to linger. We need places that leave room for chance encounters.

## The useful ordinary

- A seat in the shade.
- A path wide enough for a conversation.
- A public library with an open door.
- A little less urgency.

These things rarely make the cover of a design magazine. But they are the things we remember, the things that turn an address into a neighborhood.

Next time you find a place that makes you want to stay, notice what it asks of you. Often, the answer is nothing.`,
      5,
      "assets/architecture.svg",
      ["Design", "Culture"],
    ),
    demoPost(
      "note-garden",
      demoAuthors[2],
      "",
      "",
      "A small reminder from the garden today: not everything needs to be productive to be worth your attention.\n\nSome things can just be beautiful. 🌱",
      6,
      undefined,
      ["Nature"],
    ),
    demoPost(
      "attention",
      demoAuthors[2],
      "A field guide to paying attention",
      "What a month of walking the same path taught me about noticing.",
      `For thirty mornings, I walked the same path. No headphones. No particular destination. Just the mile between my front door and the old bridge.

The first week, I thought I had seen everything. By the third, I realized I had barely begun.

## Look twice

There was a wren nesting in the wall. A crack in the pavement that became a garden. A man who put out water for the neighborhood cats at precisely half past eight.

**Attention is a form of participation.** When we notice a place, we become part of it.

> You do not need a new landscape. Sometimes you need another morning in the one you already have.

I started keeping a notebook. Not for profound observations. Just for things I might otherwise forget:

- The first day the swallows came back.
- The smell of rain before it arrived.
- A conversation that began with a dog.

## A practice, not a project

There is no finished version of paying attention. No milestone to put on a profile. It is simply something you can do, again, tomorrow.

The path is still the same. I am not.`,
      9,
      "assets/garden.svg",
      ["Nature", "Life"],
    ),
    demoPost(
      "small-hours",
      demoAuthors[3],
      "",
      "",
      "The nicest thing about an open network is that a reply can come from anywhere. Different servers, same conversation.\n\nWhat have you been reading this week?",
      12,
      undefined,
      ["Technology"],
    ),
  ];
  export function demoComments(post: Post): Post[] {
    return [
      demoPost(
        `${post.id}-reply-1`,
        demoAuthors[3],
        "",
        "",
        "“A practice we can begin again.” This really stayed with me. Thank you for making space for these conversations.",
        1,
      ),
      demoPost(
        `${post.id}-reply-2`,
        demoAuthors[2],
        "",
        "",
        "There is so much good in the small corners. I found this through a friend’s reply, which feels fitting.",
        0.5,
      ),
    ].map((p) => ({ ...p, replyTo: post.id, likes: 0, replies: 0 }));
  }
  export function initialConversations(): Conversation[] {
    return [
      {
        id: "demo-mara",
        accounts: [demoAuthors[0]],
        unread: true,
        messages: [
          demoPost(
            "dm-1",
            demoAuthors[0],
            "",
            "",
            "Hey! Thank you for the thoughtful reply to my essay. I’d love to hear more about what you’re working on.",
            3,
          ),
          demoPost(
            "dm-2",
            demoMe,
            "",
            "",
            "Of course! I’ve been thinking about how we make more room for long-form writing on the open web.",
            2.5,
          ),
          demoPost(
            "dm-3",
            demoAuthors[0],
            "",
            "",
            "That sounds lovely. A reading room for the fediverse. Keep me posted 🌿",
            1,
          ),
        ],
      },
      {
        id: "demo-elliot",
        accounts: [demoAuthors[1]],
        unread: false,
        messages: [
          demoPost(
            "dm-4",
            demoAuthors[1],
            "",
            "",
            "I finally finished that book you mentioned. So many good ideas about public spaces!",
            20,
          ),
        ],
      },
    ].map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        visibility: "direct" as const,
      })),
    }));
  }
}
