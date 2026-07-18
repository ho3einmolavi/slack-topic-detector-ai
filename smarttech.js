// const numbers = [2,7,11,15]

// const target = 9

function returnPairs(numbers, target) {

    const numbersMap = new Map()

    for (let i=0; i < numbers.length; i++) {
        numbersMap.set(numbers[i], i)
    }

    const result = new Set()
    for (let i=0; i < numbers.length; i++) {
        const number = numbers[i]

        const numberToFind = target - number

        if (numbersMap.has(numberToFind)) {
            result.add(numbersMap.get(numberToFind))
            result.add(i)
        }
    }

    return result

}

console.log(returnPairs([2,7,11,15, 8, 1], 9))