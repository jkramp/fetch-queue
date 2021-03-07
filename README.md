![Alt text](./logo.svg)

# fetch-queue
A simple queue system for fetch requests

See https://github.com/jkramp/fetch-queue for complete documentation.

## TL;DR?

1. Import and use just as you would with fetch
2. Profit!

_NOTE: This assumes fetch is globally available_

## Yet another queue tool?
There are a lot of queuing tools out there. This one is specific to fetch and built to be a drop in replacement for fetch.


## Basic Usage

Import and call in place of fetch. This can be called in multiple parts of an application or in a batch using Promise.all or Promise.allSettled

```javascript
    import fetchQueue from 'fetch-queue'

    Promise.allSettled([
        fetchQueue('https://example.com/endpoint1',{
                method: 'POST',
                body: JSON.stringify({test:123})
            }).then(resp=>resp.json()),
        fetchQueue('https://example.com/endpoint2',{
                method: 'POST',
                body: JSON.stringify({test:123})
            }).then(resp=>resp.json()),
        fetchQueue('https://example.com/endpoint3',{
                method: 'POST',
                body: JSON.stringify({test:123})
            }).then(resp=>resp.json())
    ]
    .then(resp=>{
        console.log('DONE', resp)
    }).catch(error=>{
        console.log(error)
    })
```

## Advanced Usage

```javascript

    import {
        debugQueue,
        createQueue,
        fetchQueue,
        checkQueue,
        killQueue,
        destroyQueue,
     } from 'fetch-queue'

    // enable debugging to the console
    debugQueue()

    // create a custom queue
    createQueue('mySpecialQueue', {
        concurrent: 3, // how many fetch requests the queue will process at any given time
        retries: 3,  // how many retries will occur on a failed request
        retryDelay: 10, // how many seconds between retries (approx)
        fetchOptions: {
            headers: {
                Authorization: 'bearer 123456'
            }
        }, // preset fetch options to be included with each request
        baseUrl: 'https://example.com/', // prefix urls with this string
        concurrent: 3,
        retryOn: [408, 409, 418, 425, 429, '5xx'] // http response codes that the queue should retry
    })

    // add item to a custom queue
    fetchQueue('endpoint1',{
            method: 'POST',
            body: JSON.stringify({test:123})
        }, 'mySpecialQueue')
        .then(resp=>resp.json()) 
        .then(resp=>{
            console.log('DONE', resp)
        }).catch(error=>{
            console.log(error)
        })

    // check the status of a queue
    let result = checkQueue('mySpecialQueue')

    // kill a queue 
    killQueue('mySpecialQueue').then(()=>{
        console.log('Queue is dead')
    })

    destroyQueue('mySpecialQueue').then(()=>{
        console.log('Queue no longer exists')
    })
```

## License

fetch-queue is licensed under the GPLv3.  
See [License.txt](./License.txt)

---

Copyright (C) 2021 Jeff Kramp 
This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

---

Logo by Dan Hetteix